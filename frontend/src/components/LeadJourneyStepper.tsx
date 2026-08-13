import React from 'react';
import { User, Phone, CheckCircle2, Award, Clock, ArrowRight, Check, AlertCircle } from 'lucide-react';

export interface LeadStepInfo {
  stepNumber: number; // 1 to 5
  stepName: string;
  stepDetail: string;
  statusType: 'completed' | 'active' | 'pending' | 'warning';
  steps: {
    number: number;
    title: string;
    description: string;
    state: 'done' | 'current' | 'todo' | 'alert';
  }[];
}

export function calculateLeadJourney(
  contact: {
    status?: string;
    interest_level?: string;
    lead_score?: number | null;
    assigned_counselor_id?: string | null;
    counselor_followup_status?: string | null;
  },
  counselorName?: string | null
): LeadStepInfo {
  const isCallDone = contact.status === 'Completed';
  const isCalling = contact.status === 'Calling';
  const isCallFailed = contact.status === 'Failed';
  const isReschedule = contact.status === 'NeedsReschedule' || contact.status === 'Scheduled';
  
  const hasScore = (contact.lead_score !== undefined && contact.lead_score !== null && contact.lead_score > 0);
  const isScored = (contact.interest_level && contact.interest_level !== 'UNSCORED') || hasScore;
  const isAssigned = !!contact.assigned_counselor_id;
  const isFollowupCompleted = contact.counselor_followup_status === 'Completed';
  const isFollowupInProgress = contact.counselor_followup_status === 'InProgress';

  let stepNumber = 1;
  let stepName = 'Lead Ingested';
  let stepDetail = 'Registered in CRM';
  let statusType: 'completed' | 'active' | 'pending' | 'warning' = 'pending';

  // Step 5: Follow-up Completed / Converted
  if (isFollowupCompleted) {
    stepNumber = 5;
    stepName = 'Follow-up Completed';
    stepDetail = 'Admissions follow-up concluded';
    statusType = 'completed';
  }
  // Step 4: Counselor Assigned
  else if (isAssigned) {
    stepNumber = 4;
    stepName = isFollowupInProgress ? 'Counselor Outreach' : 'Counselor Assigned';
    stepDetail = counselorName ? `Assigned to ${counselorName}` : 'Assigned to counselor';
    statusType = 'active';
  }
  // Step 3: AI Scored & Qualified
  else if (isScored) {
    stepNumber = 3;
    const scoreVal = Math.round(contact.lead_score || 0);
    stepName = contact.interest_level === 'HOT' ? `Hot Lead (${scoreVal}/100)` : contact.interest_level === 'WARM' ? `Warm Lead (${scoreVal}/100)` : `Cold Lead (${scoreVal}/100)`;
    stepDetail = 'AI qualification complete — Awaiting assignment';
    statusType = 'active';
  }
  // Step 2: AI Calling
  else if (isCallDone || isCalling || isReschedule || isCallFailed) {
    stepNumber = 2;
    if (isCalling) {
      stepName = 'AI Dialing';
      stepDetail = 'Call currently in progress';
      statusType = 'active';
    } else if (isReschedule) {
      stepName = 'Callback Scheduled';
      stepDetail = 'Follow-up callback queued';
      statusType = 'active';
    } else if (isCallFailed) {
      stepName = 'Call Unreached';
      stepDetail = 'No answer / busy';
      statusType = 'warning';
    } else {
      stepName = 'AI Call Completed';
      stepDetail = 'Call answered — scoring calculated';
      statusType = 'completed';
    }
  } else {
    // Step 1: Uploaded
    stepNumber = 1;
    stepName = 'Lead Ingested';
    stepDetail = 'Queued for AI outreach';
    statusType = 'pending';
  }

  const steps = [
    {
      number: 1,
      title: '1. Ingested',
      description: 'Lead registered',
      state: (stepNumber >= 1 ? 'done' : 'todo') as 'done' | 'current' | 'todo' | 'alert'
    },
    {
      number: 2,
      title: '2. AI Call',
      description: isCalling ? 'Dialing now' : isCallFailed ? 'Unreached' : isCallDone ? 'Connected' : 'Queued',
      state: (stepNumber > 2 ? 'done' : stepNumber === 2 ? (isCallFailed ? 'alert' : 'current') : 'todo') as 'done' | 'current' | 'todo' | 'alert'
    },
    {
      number: 3,
      title: '3. AI Score',
      description: isScored ? `${contact.interest_level || 'Scored'} (${Math.round(contact.lead_score || 0)})` : 'Pending evaluation',
      state: (stepNumber > 3 ? 'done' : stepNumber === 3 ? 'current' : 'todo') as 'done' | 'current' | 'todo' | 'alert'
    },
    {
      number: 4,
      title: '4. Counselor',
      description: counselorName ? counselorName : isAssigned ? 'Assigned' : 'Unassigned',
      state: (stepNumber > 4 ? 'done' : stepNumber === 4 ? 'current' : 'todo') as 'done' | 'current' | 'todo' | 'alert'
    },
    {
      number: 5,
      title: '5. Admission Outcome',
      description: isFollowupCompleted ? 'Completed' : isFollowupInProgress ? 'In Consultation' : 'Action Needed',
      state: (stepNumber === 5 ? 'done' : 'todo') as 'done' | 'current' | 'todo' | 'alert'
    }
  ];

  return { stepNumber, stepName, stepDetail, statusType, steps };
}

/**
 * Compact Pill Badge showing current step (for tables and cards)
 */
export function LeadStepBadge({
  contact,
  counselorName,
  onClick
}: {
  contact: any;
  counselorName?: string | null;
  onClick?: () => void;
}) {
  const journey = calculateLeadJourney(contact, counselorName);

  const colors = {
    5: { bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
    4: { bg: 'rgba(139, 92, 246, 0.12)', text: '#8b5cf6', border: 'rgba(139, 92, 246, 0.3)' },
    3: { bg: 'rgba(245, 158, 11, 0.12)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
    2: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' },
    1: { bg: 'rgba(148, 163, 184, 0.12)', text: 'var(--text-secondary)', border: 'rgba(148, 163, 184, 0.3)' },
  };

  const scheme = colors[journey.stepNumber as keyof typeof colors] || colors[1];

  return (
    <div
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px',
        borderRadius: '999px',
        background: scheme.bg,
        border: `1px solid ${scheme.border}`,
        fontSize: '0.75rem',
        fontWeight: 600,
        color: scheme.text,
        whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'var(--transition-smooth)'
      }}
      title={`Current Pipeline Stage: Step ${journey.stepNumber} of 5 (${journey.stepDetail})`}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: scheme.text,
          display: 'inline-block'
        }}
      />
      <span>Step {journey.stepNumber}/5: {journey.stepName}</span>
    </div>
  );
}

/**
 * Interactive Full 5-Step Admissions Stepper (for lead detail drawers and priority cards)
 */
export function LeadJourneyStepper({
  contact,
  counselorName
}: {
  contact: any;
  counselorName?: string | null;
}) {
  const journey = calculateLeadJourney(contact, counselorName);

  return (
    <div
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            Admissions Pipeline Journey
          </span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: 700,
              background: journey.stepNumber === 5 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
              color: journey.stepNumber === 5 ? '#10b981' : '#3b82f6',
              border: `1px solid ${journey.stepNumber === 5 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
            }}
          >
            Step {journey.stepNumber} of 5 Active
          </span>
        </div>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {journey.stepDetail}
        </div>
      </div>

      {/* Horizontal Connected Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', width: '100%', paddingTop: '6px', paddingBottom: '4px' }}>
        {journey.steps.map((s, idx) => {
          const isDone = s.state === 'done';
          const isCurrent = s.state === 'current';
          const isAlert = s.state === 'alert';

          const nodeColor = isDone ? '#10b981' : isAlert ? '#ef4444' : isCurrent ? '#3b82f6' : 'var(--text-muted)';
          const nodeBg = isDone ? '#10b981' : isAlert ? '#ef4444' : isCurrent ? '#3b82f6' : 'var(--bg-secondary)';
          const nodeTextColor = isDone || isAlert || isCurrent ? '#ffffff' : 'var(--text-muted)';

          return (
            <React.Fragment key={s.number}>
              {/* Step Node */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, minWidth: '70px', textAlign: 'center' }}>
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    background: nodeBg,
                    border: `2px solid ${nodeColor}`,
                    color: nodeTextColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    boxShadow: isCurrent ? '0 0 0 4px rgba(59, 130, 246, 0.2)' : isDone ? '0 0 0 3px rgba(16, 185, 129, 0.15)' : 'none',
                    transition: 'var(--transition-smooth)'
                  }}
                  title={`${s.title}: ${s.description}`}
                >
                  {isDone ? <Check size={14} strokeWidth={3} /> : isAlert ? <AlertCircle size={14} /> : s.number}
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, marginTop: '6px', color: isCurrent ? 'var(--text-primary)' : isDone ? '#10b981' : 'var(--text-muted)' }}>
                  {s.title}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', maxWidth: '85px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.description}
                </div>
              </div>

              {/* Connecting line */}
              {idx < journey.steps.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: '3px',
                    background: idx < journey.stepNumber - 1 ? '#10b981' : 'var(--border-color)',
                    margin: '0 4px',
                    marginTop: '-24px',
                    borderRadius: '999px',
                    transition: 'var(--transition-smooth)'
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
