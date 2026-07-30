# AWS Cognito Setup — Multi-School Logins

**Cognito is the only login path.** The old hardcoded `ADMIN_EMAIL`/
`ADMIN_PASSWORD` fallback has been removed — every login, including the
platform admin's, is a real Cognito account now. Until the env vars at the
bottom of this page are set, **login is unavailable entirely** (the API
returns 503), so this setup is required before the app can be used, not
optional.

---

## 1. Create the User Pool

AWS Console → **Cognito** → **User pools** → *Create user pool*

| Step | Setting | Value |
|---|---|---|
| Sign-in options | Cognito user pool sign-in options | **Email** |
| Password policy | Password policy mode | Cognito defaults (8+ chars, upper, lower, number) |
| MFA | MFA enforcement | **No MFA** (can be added later) |
| Self-registration | Enable self-registration | **Disabled** — schools are created by you, not self-signup |
| Email | Email provider | *Send email with Cognito* (fine — the app suppresses Cognito's own emails and shows you the temp password directly) |
| User pool name | | `call-manager-schools` |

### App client (same wizard, "Configure app client" step)

| Setting | Value |
|---|---|
| App type | **Public client** (SPA) or **Confidential client** (Traditional web app) — both work |
| App client name | `call-manager-backend` |
| Client secret | Public client: none generated, none needed. Confidential client: Cognito generates one — copy it into `COGNITO_CLIENT_SECRET` below (the backend computes the required `SECRET_HASH` automatically). |

Create the pool.

## 2. Enable the password auth flow

The backend proxies login so the dashboard keeps its plain email/password form.
That requires one non-default flow to be enabled.

User pool → **App clients** → click `call-manager-backend` → *Edit* under
**Authentication flows** → tick:

- ☑ **ALLOW_USER_PASSWORD_AUTH**
- ☑ ALLOW_REFRESH_TOKEN_AUTH *(usually on already)*

Save.

> If this is missed, every school login fails with `InvalidParameterException:
> USER_PASSWORD_AUTH flow not enabled for this client`.

## 3. Add the `school_id` custom attribute

This is what binds a login to its school — without it, a school user has no tenant.

User pool → **Sign-up** tab → **Custom attributes** → *Add custom attribute*:

| Field | Value |
|---|---|
| Name | `school_id` |
| Type | String |
| Min / Max length | 1 / 64 |
| Mutable | ☑ **Yes** |

It appears in tokens as `custom:school_id` — that exact name is what the backend reads.

> Custom attributes **cannot be added after users exist in some pool
> configurations**, and can never be renamed or deleted — add this before
> onboarding any school.

Then let the app write it: **App clients** → `call-manager-backend` →
*Attribute read and write permissions* → ensure `custom:school_id` is
**readable** (write permission isn't needed; the backend sets it via the admin API).

## 4. Platform-admin group (required — this is the only way to get admin access)

User pool → **Groups** → *Create group* → name it exactly **`platform-admin`**.
Any user in this group gets full cross-school access; everyone else is scoped
to their `custom:school_id`.

Create at least one platform admin now, or the dashboard has no way in:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id ap-south-2_Amkiyam5r \
  --username your-real-admin@yourcompany.com \
  --user-attributes Name=email,Value=your-real-admin@yourcompany.com Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --temporary-password "SomeTempPass1!"

aws cognito-idp admin-add-user-to-group \
  --user-pool-id ap-south-2_Amkiyam5r \
  --username your-real-admin@yourcompany.com \
  --group-name platform-admin
```

(Or via console: **Users → Create user**, then open that user → **Group
memberships → Add to group** → `platform-admin`.) The IAM identity running
these needs `cognito-idp:AdminCreateUser` and `cognito-idp:AdminAddUserToGroup`
on the pool — see the policy below, which already includes both.

## 5. IAM credentials for the backend

Onboarding a school calls `AdminCreateUser`, so the backend needs AWS
credentials. Create an IAM user (or use the instance role) with this policy —
replace the ARN with your pool's:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:CreateGroup",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminListGroupsForUser"
    ],
    "Resource": "arn:aws:cognito-idp:<region>:<account-id>:userpool/<pool-id>"
  }]
}
```

The `CreateGroup`/`AdminAddUserToGroup`/`AdminListGroupsForUser` actions are
only needed once, to set up the `platform-admin` group above — the app itself
never calls them at runtime.

`InitiateAuth` and `RespondToAuthChallenge` (the login calls) are public API
actions and need no IAM permission.

## 6. Environment variables

Set these on the backend (Coolify → backend service → **Environment Variables**),
then redeploy:

```
COGNITO_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

- **Pool ID**: User pool → *Overview* → "User pool ID"
- **Client ID**: User pool → *App clients* → "Client ID"
- **Client secret**: only if you created a confidential client — App client
  page → "Show client secret". Leave `COGNITO_CLIENT_SECRET` unset entirely
  for a public client.
- Skip the two `AWS_*` vars if the host already has an instance role with the
  policy above.

Login is fully unavailable (503) until `COGNITO_REGION`, `COGNITO_USER_POOL_ID`
and `COGNITO_CLIENT_ID` are all set — there's no fallback anymore.

Until all three `COGNITO_*` vars are present, the app logs no error — it simply
reports "Cognito is not configured" when you try to onboard a school with a
login email, and the env-var admin login continues to work.

---

## How onboarding works once this is set up

1. Sign in as the platform admin → **Schools** tab → *Onboard School*.
2. Fill in name, location, admissions phone, and the school's login email.
3. On save the app:
   - creates the school's tenant record,
   - provisions **its own Retell voice agent** (its prompt speaks that
     school's name, location and phone — not the template school's),
   - creates the Cognito user with `custom:school_id` set,
   - shows a **temporary password once** — copy it and send it to the school.
4. The school signs in with that temp password, is immediately asked to choose
   a real one, and lands on a dashboard showing **their school name** and only
   their own leads, campaigns, appointments and call history.

**The temporary password is shown exactly once and is never stored.** If it's
lost, use the *Password* button on the school's card to issue a new one.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `USER_PASSWORD_AUTH flow not enabled` | Step 2 was skipped |
| School logs in but sees another school's data | `custom:school_id` missing or not readable by the app client (step 3) |
| "Cognito is not configured" on onboarding | One of the three `COGNITO_*` env vars is unset |
| `AccessDeniedException` on onboarding | IAM policy in step 5 missing or wrong pool ARN |
| Login works but header shows no school name | User has no `custom:school_id` — recreate the login via *Password* reset on the school card |
