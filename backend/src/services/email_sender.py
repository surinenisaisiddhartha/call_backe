import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_booking_email(
    smtp_server: str,
    smtp_port: int,
    username: str,
    password: str,
    from_email: str,
    to_email: str,
    attendee_name: str,
    purpose: str,
    scheduled_for_str: str,
    gcal_link: str = None,
    virtual_meeting_link: str = None,
    meeting_type: str = "in_person"
) -> bool:
    """
    Sends a styled confirmation HTML email to the caller.
    If credentials are missing or connection fails, falls back to logging a warning.
    """
    if not smtp_server or not username or not password or not from_email:
        print("[EMAIL SENDER] Warning: SMTP settings are not fully configured. Skipping email dispatch (Dry Run).", flush=True)
        print(f"  [Dry Run Output] To: {to_email} | Name: {attendee_name} | Purpose: {purpose} | Time: {scheduled_for_str}", flush=True)
        return False

    try:
        # Create message container
        is_virtual = meeting_type == "virtual"
        msg = MIMEMultipart("alternative")
        subject_suffix = "Your Virtual Meeting" if is_virtual else "Your Campus Visit"
        msg["Subject"] = f"Confirmed: {subject_suffix} at The Shri Ram Academy"
        msg["From"] = f"TSRA Admissions <{from_email}>"
        msg["To"] = to_email

        # Premium HTML Template
        html = f"""
        <html>
        <head>
            <style>
                body {{
                    font-family: 'Inter', Helvetica, Arial, sans-serif;
                    background-color: #f4f6f8;
                    color: #1a202c;
                    margin: 0;
                    padding: 0;
                }}
                .container {{
                    max-width: 600px;
                    margin: 40px auto;
                    background-color: #ffffff;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                }}
                .header {{
                    background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
                    color: #ffffff;
                    padding: 32px 24px;
                    text-align: center;
                }}
                .header h1 {{
                    margin: 0;
                    font-size: 24px;
                    font-weight: 800;
                    letter-spacing: -0.025em;
                }}
                .header p {{
                    margin: 8px 0 0 0;
                    font-size: 14px;
                    opacity: 0.9;
                }}
                .content {{
                    padding: 32px 24px;
                }}
                .greeting {{
                    font-size: 18px;
                    font-weight: 700;
                    margin-top: 0;
                    margin-bottom: 16px;
                    color: #2d3748;
                }}
                .details-box {{
                    background-color: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 24px 0;
                }}
                .detail-row {{
                    display: flex;
                    margin-bottom: 12px;
                    font-size: 15px;
                }}
                .detail-row:last-child {{
                    margin-bottom: 0;
                }}
                .detail-label {{
                    width: 120px;
                    font-weight: 600;
                    color: #718096;
                }}
                .detail-value {{
                    flex: 1;
                    color: #2d3748;
                }}
                .button-container {{
                    text-align: center;
                    margin: 32px 0 16px 0;
                }}
                .btn {{
                    background-color: #4f46e5;
                    color: #ffffff !important;
                    text-decoration: none;
                    padding: 12px 24px;
                    border-radius: 6px;
                    font-weight: 600;
                    font-size: 15px;
                    display: inline-block;
                }}
                .footer {{
                    background-color: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                    padding: 24px;
                    text-align: center;
                    font-size: 13px;
                    color: #718096;
                }}
                .footer p {{
                    margin: 4px 0;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>The Shri Ram Academy</h1>
                    <p>Admissions & Campus Tours Outreach</p>
                </div>
                <div class="content">
                    <p class="greeting">Hello {attendee_name},</p>
                    <p>Thank you for booking a session with us. We are pleased to confirm that your appointment has been successfully scheduled. Here are your booking details:</p>
                    
                    <div class="details-box">
                        <div class="detail-row">
                            <div class="detail-label">Purpose:</div>
                            <div class="detail-value"><strong>{purpose}</strong></div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-label">Date & Time:</div>
                            <div class="detail-value">{scheduled_for_str}</div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-label">{"Meeting Link:" if is_virtual else "Location:"}</div>
                            <div class="detail-value">{
                                f'<a href="{virtual_meeting_link}" target="_blank">{virtual_meeting_link}</a>' if (is_virtual and virtual_meeting_link)
                                else "Our admissions team will share your meeting link shortly." if is_virtual
                                else "TSRA Campus, Gachibowli, Hyderabad, Telangana 500032"
                            }</div>
                        </div>
                    </div>

                    <p>An invitation has also been sent to your calendar. Please ensure you accept it to add it to your schedule.</p>

                    {f'''
                    <div class="button-container">
                        <a href="{virtual_meeting_link}" class="btn" target="_blank">Join Virtual Meeting</a>
                    </div>
                    ''' if (is_virtual and virtual_meeting_link) else (f'''
                    <div class="button-container">
                        <a href="{gcal_link}" class="btn" target="_blank">View on Google Calendar</a>
                    </div>
                    ''' if gcal_link else '')}

                    <p style="margin-top: 32px;">If you need to reschedule or have any questions prior to your {"meeting" if is_virtual else "visit"}, feel free to reply to this email or call our admissions desk directly at +91 7569891111.</p>

                    <p>We look forward to {"speaking with you!" if virtual_meeting_link else "welcoming you to our campus!"}</p>
                    
                    <p style="margin-bottom: 0;">Warm regards,<br/><strong>The TSRA Admissions Team</strong></p>
                </div>
                <div class="footer">
                    <p>&copy; 2026 The Shri Ram Academy. All rights reserved.</p>
                    <p>Gachibowli, Hyderabad, TS, India</p>
                </div>
            </div>
        </body>
        </html>
        """

        msg.attach(MIMEText(html, "html"))

        # Connect to SMTP server and send email
        smtp_port_int = int(smtp_port)
        if smtp_port_int == 465:
            server = smtplib.SMTP_SSL(smtp_server, smtp_port_int, timeout=10.0)
        else:
            server = smtplib.SMTP(smtp_server, smtp_port_int, timeout=10.0)
            server.ehlo()
            if smtp_port_int == 587:
                server.starttls()
                server.ehlo()

        server.login(username, password)
        server.sendmail(from_email, to_email, msg.as_string())
        server.close()
        print(f"[EMAIL SENDER] Confirmation email sent successfully to {to_email}")
        return True

    except Exception as e:
        print(f"[EMAIL SENDER] Error sending confirmation email to {to_email}: {e}")
        return False
