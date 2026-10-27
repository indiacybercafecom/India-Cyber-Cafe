# Security Architecture & Data Breach Incident Response Plan
**Organization:** India Cyber Cafe (ICC)  
**Applicable Frameworks:** Digital Personal Data Protection Act (DPDP Act, 2023), Information Technology Act (2000), CERT-In Cyber Security Directions (April 2022)  
**Version:** 1.0  
**Effective Date:** 1 January 2025  
**Review Cycle:** Annual or immediately following a significant security incident  

---

## 1. Overview & Objectives

This document establishes the security architecture, technical and organizational safeguards, and standard operating procedures (SOP) for detecting, triaging, containing, reporting, and learning from information security and personal data breach incidents at India Cyber Cafe.

### Core Objectives:
1. Protect customer personal information, uploaded documentation, and transaction data.
2. Ensure continuous compliance with Indian statutory reporting timelines (including CERT-In 6-hour requirement).
3. Ensure structured, repeatable incident containment without disruption to essential public services.
4. **Mandatory Constraint:** All operations strictly preserve existing password storage and authentication flows without tampering, uncoordinated resets, or destructive alterations.

---

## 2. Technical & Organizational Safeguards (Defense-in-Depth)

### 2.1 Transport Layer & Perimeter Security
- **Full HTTPS Enforced:** All communication with `indiacybercafe.com` and `b.indiacybercafe.com` is protected via TLS 1.3 / TLS 1.2 with HSTS.
- **Security Headers Enabled:**
  - `X-Content-Type-Options: nosniff` (prevents MIME sniffing)
  - `X-XSS-Protection: 1; mode=block` (browser XSS filtering)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **Embed Compatibility:** Allows controlled embedding for authorized preview and verification while isolating sensitive administrative routes.

### 2.2 Access Control & Principle of Least Privilege
- Administrative console access (`/admin`) is guarded by role-based authentication (`admin: true` in user claim / RTDB).
- Direct database and storage administration restricted to multi-factor authenticated (MFA) operator accounts.

### 2.3 Upload Validation & File Isolation
- Uploaded files are strictly restricted to verified types: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
- Filename randomization (`category/timestamp_randomString.ext`) to eliminate directory traversal attacks and namespace collision.
- Maximum individual file size capped at 5 MB.

### 2.4 Consent-Gated Telemetry
- Firebase and Google Analytics (`G-HKXGED0EB0`) fire **only after explicit affirmative opt-in consent** from the visitor.
- Consent preferences and audit history are recorded locally in `localStorage` with versioned timestamps.

---

## 3. Incident Response Team (IRT) & Escalation Hierarchy

| Role | Designation | Primary Responsibility | Contact |
|---|---|---|---|
| **Incident Commander** | Operations Head / Director | Coordinates overall response, external notifications, and legal counsel | icc@indiacybercafe.com |
| **Technical Lead** | Lead Full-Stack Engineer | Log analysis, technical containment, vulnerability patching, code audits | indiacybercafe.com@gmail.com |
| **Grievance & Privacy Officer** | Data Protection Officer | Evaluates DPDP Act impact, communicates with affected Data Principals | icc@indiacybercafe.com |
| **Communications Lead** | Support Team Lead | Public updates, customer helpline briefings | +91-9203251821 |

---

## 4. Nine-Stage Incident Response Workflow

```
[1. Detection & Identification]
               │
               ▼
        [2. Triage & Severity Classification]
               │
               ▼
        [3. Evidence Preservation]
               │
               ▼
        [4. Containment (Immediate & Long-Term)]
               │
               ▼
        [5. Statutory Notifications (CERT-In / DPDP Board)]
               │
               ▼
        [6. Eradication & Root Cause Remediation]
               │
               ▼
        [7. Recovery & System Validation]
               │
               ▼
        [8. Data Principal Notification]
               │
               ▼
        [9. Post-Incident Review & Playbook Update]
```

### Stage 1: Detection & Identification
Incidents may be detected via:
- Automated error spikes, anomalous API invocation patterns on `/api/*`.
- Cloud monitoring or Firebase Security Rules denial reports.
- User or security researcher vulnerability reports received at `icc@indiacybercafe.com`.
- Notification from payment gateway (Razorpay) or hosting partners.

### Stage 2: Triage & Severity Classification

| Severity Level | Definition | Statutory Action Required |
|---|---|---|
| **P1 - Critical** | Unauthorized exfiltration of customer documents or database records; active system compromise | Immediate containment; **CERT-In notification within 6 hours**; Data Protection Board notification |
| **P2 - High** | Denial of service on core filing engine; compromise of non-confidential telemetry; unauthorized configuration change | Containment within 4 hours; root cause analysis; report if personal data at risk |
| **P3 - Medium** | Phishing impersonation of ICC branding; isolated user account credential issue; failed brute-force attempt | Mitigation within 12 hours; customer alert on official portal |
| **P4 - Low** | Minor software lint/dependency warning; non-exploitable error disclosure | Standard sprint resolution; documentation update |

### Stage 3: Evidence Preservation
- **Do not immediately reboot or wipe active instances.**
- Export access logs, server process outputs, and cloud audit logs to write-once storage.
- Record exact UTC and IST timestamps for all remediation steps.
- Maintain a strict chain-of-custody log for all digital forensic materials.

### Stage 4: Containment
1. **Short-Term Containment:**
   - Revoke compromised API keys or service account credentials.
   - Isolate affected network routes or temporarily restrict file upload endpoints.
   - Block malicious IP addresses at Cloud CDN / proxy layer.
2. **Long-Term Containment:**
   - Deploy hotfix patch to application codebase.
   - Update security rules and input sanitization routines.

### Stage 5: Statutory Notifications (Indian Legal Mandates)

#### A. CERT-In Mandatory 6-Hour Reporting
Under Cyber Security Directions (April 2022) issued by CERT-In:
- **Mandatory Reporting Window:** Within **6 hours** of noticing or being brought to notice of specified cybersecurity incidents.
- **Reporting Channels:**
  - Email: `incident@cert-in.org.in`
  - Website: `https://www.cert-in.org.in`
  - Incident Reporting Format: Incident type, affected IP/domain, date & time of occurrence, brief narrative of impact, containment measures in progress.

#### B. Data Protection Board of India (DPDP Act, 2023)
- Under Section 8(6) of the DPDP Act, in the event of a personal data breach, the Data Fiduciary shall notify the **Data Protection Board of India** and each affected **Data Principal** in such form and manner as prescribed.
- Notification must outline:
  - Nature and categories of personal data compromised.
  - Number of individuals affected.
  - Likely consequences and risks to Data Principals.
  - Action taken to mitigate harm and contact details of the Grievance Officer.

### Stage 6: Eradication & Root Cause Remediation
- Identify and eliminate the root cause (e.g., vulnerable package, missing validation, or configuration drift).
- Inspect database integrity to verify no unauthorized records or backdoor keys were created.
- Review and verify all code changes through `npm run lint` and `npm run build`.

### Stage 7: Recovery & System Validation
- Restore verified services to normal production operation.
- Monitor traffic and error rates continuously for 72 hours post-recovery.
- Conduct regression testing of all forms, payment flows, and grievance endpoints.

### Stage 8: Data Principal Notification
- When personal data is impacted, affected customers will be notified directly via registered email or SMS.
- Notification will be plain-language, transparent, and provide guidance on self-protection measures (e.g., monitoring official bank/government accounts).

### Stage 9: Post-Incident Review (Lessons Learned)
- Within 7 days of incident resolution, the IRT conducts a formal blameless post-mortem.
- Document:
  - Root cause analysis (5 Whys).
  - Chronological timeline of actions.
  - Gaps in detection or response speed.
  - Preventive architecture enhancements and playbook updates.

---

## 5. Absolute Password & Authentication Non-Disruption Policy

In strict conformance with project governance:
- **Zero Modification:** No script, automated tool, or incident handler is permitted to perform bulk password migrations, cleartext extractions, or destructive resets on user authentication records.
- **Preservation:** Existing password-related database tables and Firebase Authentication settings remain unchanged.

---

## 6. Testing, Drills, and Maintenance
- **Annual Tabletop Exercise:** Simulated incident scenario (e.g., ransomware, exfiltration, DNS hijack) conducted once every 12 months.
- **Quarterly Dependency Audit:** `npm audit` and vulnerability scanning of third-party libraries.
- **Contact:** For security vulnerabilities or concerns, contact `icc@indiacybercafe.com`.
