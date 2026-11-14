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
- **Role-Based Access Control (RBAC):** Strict separation between `admin`, `operator`, and `user` roles enforced across Firebase Realtime Database Security Rules (`database.rules.json`), Express backend middleware (`requireAdminMiddleware`, `verifyCallerWithRole`), and frontend route guards (`src/utils/permissions.ts`).
- **Operator Least-Privilege Scope:**
  - Operators have **zero** access to global `/users`, `/gateways`, `/services`, `/products`, `/documents`, `/privacy_requests`, `/payments`, `/driveConnections` (of other users), or Admin endpoints (`/api/sync-data*`, `/api/documents*`, `/api/admin/*`).
  - Operators can read/update only their own `/users/$uid` profile (cannot modify `role`, `uid`, `email`, or `disabled`).
  - Disabled users (`disabled === true`) are immediately blocked at both RTDB rules and Express API authorization layers.
  - Operators see and access **only** service applications (and assigned orders where applicable) matched canonically by immutable Firebase Auth UID (`assignedToUid === auth.uid`). Broad email queries and legacy email fallbacks are disabled so email reuse or misconfigured records cannot expose another UID's data; unmatched legacy assignments are flagged for Admin review.
  - Operators can write only `applications/$appId/status` (`processing | clarification | completed | rejected`), `applications/$appId/updatedAt`, and append-only `applications/$appId/notes/$noteId` entries (max 2,000 characters, server-sanitized). Payment fields (`paymentStatus`, `charge`), applicant PII, assignments, and deletions are blocked for Operators.
- **Payment Integrity:** Direct client writes to `/applications/$appId/paymentStatus` are blocked for customers and operators; post-work application payments verify Razorpay HMAC-SHA256 signatures server-side via `POST /api/applications/:appId/verify-payment`.
- **Plaintext Passwords Eliminated from User Management:** Password storage/impersonation ("Login as User") in `UserManageModal` and RTDB `password` writes are blocked by `.validate` rules (`!newData.hasChild('password')`).
- **MFA Status (Honest Implementation Note):** Firebase Authentication multi-factor authentication (MFA) is recommended operationally in the Firebase Console for Super Admin and Operator accounts, and is not currently enforced programmatically in application code.

### 2.3 Upload Validation & Authenticated Attachment Isolation
- Uploaded note attachments via `POST /api/operator/applications/:appId/upload-attachment` (multipart field `file`) are strictly validated by **binary magic-byte signatures** (PDF, JPEG, PNG, WEBP) and capped at 5 MB. There is no Firebase Storage fallback for Operator/Staff note attachments (`storage.rules` is not configured in this repository).
- Files and `.meta.json` descriptors are stored in randomized server-side paths outside public static directories and served strictly via `GET /api/operator/attachments/:attachmentId?appId=:appId` with Firebase Bearer ID token verification for the currently assigned Operator, Application Owner, or Admin.
- Public document and checkout image uploaders likewise enforce allowed MIME types and 5 MB caps.

### 2.4 Consent-Gated Telemetry
- Firebase and Google Analytics (`G-HKXGED0EB0`) fire **only after explicit affirmative opt-in consent** from the visitor.
- Consent preferences and audit history are recorded locally in `localStorage` with versioned timestamps.

### 2.5 Deployment, Backup & Migration Procedure (Operator Security Hardening)
1. Audit/dry-run legacy records to inspect UID backfills, conflicts, unmatched emails, and array `notes` conversion:
   `npx tsx scripts/migrate-operator-security.ts --dry-run`
2. Create an offline verified backup (optional standalone step; `--apply` also writes & verifies a backup automatically before modifying data):
   `npx tsx scripts/migrate-operator-security.ts --backup-only`
3. Apply idempotent migration with Firebase Admin credentials configured (creates & verifies `data/backups/operator-migration-backup-<timestamp>.json`, applies updates, verifies record/note/attachment counts):
   `npx tsx scripts/migrate-operator-security.ts --apply`
4. Roll back `applications` and `orders` from backup if ever needed:
   `npx tsx scripts/migrate-operator-security.ts --rollback=data/backups/<backup-file>.json --apply`
5. Deploy updated RTDB rules to Firebase:
   `firebase deploy --only database`
6. Run verification suite (`npx tsx scripts/test-rules.ts`). Note: Firebase Database Emulator requires Java (JRE), which is not installed in this sandbox environment; run `firebase emulators:exec --only database "npx tsx scripts/test-rules.ts"` in a Java-enabled CI/local environment for full official emulator validation.

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
