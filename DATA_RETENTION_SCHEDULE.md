# Data Retention, Archival & Disposal Schedule
**Entity:** India Cyber Cafe (ICC)  
**Applicable Regulations:** Digital Personal Data Protection Act, 2023 (DPDP Act); Indian Information Technology Act, 2000; Goods and Services Tax Act, 2017; Consumer Protection (E-Commerce) Rules, 2020  
**Version:** 1.0  
**Effective Date:** 1 January 2025  

---

## 1. Principles of Purpose & Storage Limitation

In compliance with the **DPDP Act (Section 6 & 8)**, India Cyber Cafe retains personal data only for as long as is strictly necessary to satisfy the specific purpose for which it was collected, or as required by applicable statutory obligations (taxation, audit, dispute redressal).

Once the retention period has lapsed, personal data must be irreversibly deleted, anonymized, or securely destroyed.

---

## 2. Retention Schedule by Data Category

| Data Category | Collection Point | Specific Purpose | Retention Period | Statutory / Business Justification | Disposal Method |
|---|---|---|---|---|---|
| **Service Applications** | `/apply/:serviceId` | Filing government forms, exams, certificates | **3 Years** from service completion | Limitation Act period for service disputes & consumer warranty claims | Soft-delete in RTDB, followed by quarterly permanent purge |
| **Uploaded Identity Documents** | Application Form (PDF, JPG, PNG) | Proof of eligibility, identity verification | **90 Days** from successful application submission (or immediately upon customer request) | Storage minimization once government acknowledgment slip is generated | Permanent object deletion from Firebase Storage bucket |
| **Store Orders & Deliveries** | `/store/:categoryId/:productId/checkout` | Order fulfillment, shipping, product warranty | **3 Years** from delivery date | Consumer Protection (E-Commerce) Rules, 2020 & return/warranty claims | Secure database purge |
| **Invoices & Tax Records** | Auto-generated invoice / Razorpay webhook | GST compliance, accounting audits | **7 Years** from end of relevant financial year | Section 36 of Central Goods and Services Tax (CGST) Act, 2017 | Cold storage archival with restricted CFO/Accountant access |
| **Payment Metadata** | Razorpay callback / server verification | Reconciliation, fraud defense | **7 Years** | Reserve Bank of India (RBI) payment settlement guidelines | Secure archival, no cardholder PAN/CVV stored |
| **Instant Call-Back Requests** | Quick Callback Modal | Returning customer phone inquiries | **30 Days** from resolution | Customer relationship follow-up | Automated database cleanup or log rotation |
| **Privacy Requests & Grievances** | `/privacy-request` & Admin Portal | Tracking DPDP rights, audits, compliance proof | **3 Years** from resolution date | Evidence of compliance under DPDP Section 8 and Consumer Protection Rules | Exportable encrypted audit log, then secure purge |
| **Consent Preferences** | Consent Banner & Modal | Tracking visitor cookie/analytics consent | **12 Months** (or until reset by user) | DPDP accountability requirements | LocalStorage expiry / client overwrite |
| **Server & Access Logs** | Node/Express middleware | Security monitoring, incident investigation | **180 Days** | CERT-In Directions 2022 on ICT log preservation | Automated log rotation & secure shredding |

---

## 3. Safe Destruction & Cryptographic Erasure Procedures

### 3.1 Digital Document Purging
- Supporting uploaded files in Firebase Storage are deleted using Google Cloud Storage API object deletion commands (`deleteObject`), which marks the blocks for irreversible overwrite in Google infrastructure.
- References in application records are set to `null` to prevent dangling links.

### 3.2 Database Record Deletion
- When an erasure request is executed through the Admin Grievance Portal (`/admin` -> Privacy Requests), personal identifying values (name, phone, address, custom photos) are removed or pseudonymized.

### 3.3 Physical Records & Paper Printouts
- Any physical paper test-prints, scrap papers with customer particulars, or misprinted cyber cafe documents are immediately fed into a cross-cut shredder (DIN 66399 Level P-4).

---

## 4. Individual Erasure Request Workflow

1. **Submission:** Customer submits an erasure or consent-withdrawal ticket via `/privacy-request`.
2. **Identity Verification:** Request is verified via matching email or phone number.
3. **Assessment:** Grievance Officer evaluates if any statutory retention overrides the request (e.g., GST invoice retention for 7 years cannot be deleted before the statutory timeline, but uploaded identity docs can be immediately purged).
4. **Action:** Approved personal data is deleted within **15 business days**.
5. **Confirmation:** Written confirmation and ticket closure notification is dispatched to the customer's email.

---

## 5. Non-Disruption Clause: User Passwords & Authentication

- In compliance with project governance and data protection safeguards:
  - Existing user password fields in Firebase Realtime Database and Firebase Authentication are excluded from destructive migrations or speculative schema changes.
  - User accounts and login credentials remain strictly under the control of the respective account owners.

---

## 6. Review & Compliance Oversight

- **Compliance Officer:** Grievance Redressal Officer (`icc@indiacybercafe.com`)
- **Audit Cadence:** Bi-annual review of retention schedules against current gazette notifications and DPDP rule amendments.
