# ProsperWise Advisors — Privacy & Security Policy

**Last updated:** August 2026
**Applies to:** ProsperWise Portal (the client portal and internal CRM operated by ProsperWise Advisors)

## About this document

This policy describes how ProsperWise Advisors ("ProsperWise", "we", "us") collects, uses, protects, and retains personal and financial information through the ProsperWise Portal platform.

This document is structured around the domains used by recognized security frameworks (SOC 2 Trust Services Criteria and ISO 27001) — Security, Availability, Confidentiality, Processing Integrity, and Privacy — because that structure gives a clear, complete way to organize our practices. **ProsperWise has not undergone a formal SOC 2 or ISO 27001 certification audit, and this document does not claim such certification.** It is a self-attested statement of our current practices, informed by the rigor of those frameworks. The privacy commitments below are grounded in the Personal Information Protection and Electronic Documents Act (PIPEDA) and British Columbia's Personal Information Protection Act (PIPA), which govern how we handle personal information as a BC-based firm.

An internal technical document maps every commitment in this policy to its specific implementation, for our own audit and maintenance purposes.

---

## 1. Security

### 1.1 Authentication and access

Access to the internal system is restricted to ProsperWise staff, authenticated through their ProsperWise Google Workspace account. Client access to the portal does not use passwords; instead, clients receive a one-time passcode by email for each new session, with automatic lockout after repeated failed attempts. Returning devices may be remembered securely to reduce repeated verification, using a token that is never stored in a form that could be reversed to impersonate the device.

### 1.2 Data access controls

Our database enforces row-level access control on every table containing client or business data. Client-facing systems are architected so that clients never have direct database access — all requests pass through server-side logic that verifies the request belongs to that client's own household before returning any data.

### 1.3 Encrypted communications and storage

All data in transit between your device, our servers, and our infrastructure providers is encrypted using industry-standard TLS/HTTPS. Data at rest is encrypted at the infrastructure level by our cloud providers.

### 1.4 Third-party integration security

Where ProsperWise Portal connects to third-party services (payment processing, email, calendaring, task management, and telephony), those connections are authenticated using secure, revocable credentials. Inbound notifications from payment and telephony providers are cryptographically verified to confirm they genuinely originate from that provider before being processed.

### 1.5 Automated security monitoring

We run automated security self-checks against our production environment, covering access-control isolation, injection resistance, authentication lockout behavior, cross-origin request restrictions, and third-party credential validity. Failures trigger immediate internal alerts.

### 1.6 Outbound sensitive-data safeguard

Certain outbound client communications (SMS, email) pass through an automated filter designed to catch and block sensitive identifiers (such as government ID numbers, account numbers, and specific financial figures) and certain health-related terms before they are sent through third-party channels. This is an additional safeguard layered on top of our other controls — it is not represented as a complete or infallible data-loss-prevention system.

---

## 2. Availability

ProsperWise Portal is hosted on established cloud infrastructure providers (Google Firebase for the application, Supabase/PostgreSQL for the database) with automated deployment pipelines and platform-level redundancy provided by those vendors. **We are in the process of enabling formal database backups** for additional data-loss protection beyond the underlying infrastructure provider's own resilience — see "Where we're still building," below.

---

## 3. Confidentiality

Client information is treated as confidential and is only accessible to ProsperWise staff for legitimate business purposes related to serving that client. Documents shared through our secure Vault are access-controlled per client household, with staff able to designate specific files as client-visible before a client can see them. All Vault access is logged.

---

## 4. Processing Integrity

Our system is designed so that client-facing views of financial data (accounts, holdings, insurance policies) are always scoped to that client's own household, verified on every request. Automated tests run regularly to confirm this isolation holds.

---

## 5. Privacy

We are committed to protecting your personal information in accordance with PIPEDA and BC's PIPA. Our practices follow these principles:

**Accountability.** ProsperWise is responsible for personal information under its control and has designated individuals accountable for privacy practices.

**Identifying purposes.** We collect personal and financial information for the purpose of providing wealth advisory and family-office services — including household and relationship management, financial account tracking, insurance record-keeping, billing, and client communication.

**Consent.** Information is collected with your knowledge as part of engaging ProsperWise's services. Where we connect to third-party services on your behalf (such as sending calendar invitations or processing payments), this is done to deliver the services you've engaged us for.

**Limiting collection.** We collect information relevant to the advisory relationship — contact details, household and family structure, financial holdings and liabilities, insurance information, and correspondence related to your engagement with us. For clients coming to us through a personal sudden-wealth event (inheritance, divorce, retirement, or a windfall — not a corporate transaction), our guided intake also asks a small set of optional relational and psychological context questions to help us understand the fuller picture: financial expectations tied to the transfer, alignment with a spouse or partner on financial decisions, outside pressures on your decisions, any major purchase plans, and any friction with a previous advisor. None of these questions are required to proceed.

**Limiting use and disclosure.** Your information is used only for the purposes of providing our services and is disclosed to third parties only as necessary to deliver those services (see "Third parties we work with," below), or as required by law.

**Accuracy.** We maintain processes for staff to keep client records current and to correct information on request.

**Safeguards.** See Section 1 (Security) above for the technical and organizational measures protecting your information.

**Openness.** This document is our commitment to being transparent about our practices. We are also open about the current limits of those practices — see "Where we're still building," below.

**Individual access.** You may request a summary of the personal information we hold about you either by contacting your advisor directly, or through a self-service request in the portal. Note that ProsperWise retains client records for 7 years from the end of the advisory relationship (see "Data retention," above); we are unable to delete personal information on request during that period.

**Challenging compliance.** If you have concerns about how your information is handled, please contact your advisor or ProsperWise directly. You also have the right to file a complaint with the Office of the Privacy Commissioner of Canada or BC's Office of the Information and Privacy Commissioner.

### Third parties we work with

We work with the following categories of service providers, each of whom processes a limited scope of information necessary for their function:

- **Google Workspace** — email, calendar, document storage, and spreadsheet tools used by staff in serving your account (stored in Google's United States data region; Google does not offer a Canadian region for Workspace)
- **Google Cloud (Vertex AI)** — used to draft certain internal planning documents (such as a household's Sovereignty Survey and governance materials) from data already on file, processed in Google's Montréal region. A staff member reviews and can edit anything AI-assisted before it's used or shared with you.
- **Supabase** — our core database and application backend, where your records are stored (Canada Central region)
- **Square** — payment processing for invoicing (Square handles card details directly; ProsperWise's own systems do not store card numbers)
- **A telephony/SMS provider** — client calls and text communication, with calls and messages retained for service continuity (hosted in the United States)
- **Wix** — powers our public marketing website; being phased out of any role that touches client data

A full registry of these providers, including data-processing agreement status, is maintained internally and available on request.

### Data retention

ProsperWise retains client records for **7 years from the end of the advisory relationship**, consistent with Canadian financial-services recordkeeping practice. This applies regardless of any request to delete information sooner — we are unable to delete personal information during this retention period. Automated internal tooling flags records for staff review once that period has elapsed; deletion, if it happens at all after that point, remains a deliberate staff decision, never an automatic one.

### Where your data is stored

We keep the core of your information in Canada:

- **Your records** (contact details, household and account information, and our working notes) are stored in our production database, which runs in the **Canada Central** data center region.
- **AI-assisted drafting and document reading** is processed in Google Cloud's **Montréal** region. Our AI requests are pinned to that region and are not sent to a global endpoint.

Some of the providers we rely on operate outside Canada or do not guarantee Canadian-only processing, so we do not claim that every piece of information stays in Canada. In particular:

- Our **documents, email and calendar** (Google Workspace) are stored at rest in Google's **United States** data region. Google offers only a United States or European region for Workspace, not a Canadian one, so these are not stored in Canada. When a document is read by our AI features, that processing happens in Google Cloud's Montréal region (see above).
- Our **telephony/SMS provider** (calls, recordings and text messages) uses infrastructure in the United States.
- **Payment processing** (Square) is operated by a global provider; we have not committed it to Canadian-only processing.
- Our application is delivered through a global content network, which carries pages and files you request but is not where your records are kept.

Information handled by a provider outside Canada may be subject to the laws of the country where it is processed, including lawful access by that country's authorities. We limit what each provider receives to what it needs for its function, and we apply the safeguards described above, including filtering of sensitive identifiers before anything is sent to an outside service. If you have questions about where a particular kind of information is handled, please ask your advisor.

---

## Where we're still building

In the interest of transparency, here is what we consider works-in-progress rather than finished commitments:

- Formal, scheduled database backups (currently relying on underlying infrastructure resilience only)
- Confirming data-processing agreement status individually with each service provider in our internal subprocessor registry (the registry itself, listing every provider and what it touches, is complete — the DPA confirmations are in progress)

We'd rather tell you what we're actively improving than overstate what's already finished.

---

## Contact

Questions about this policy, or requests related to your personal information, can be directed to your ProsperWise advisor or to **rolf@prosperwise.ca**.
