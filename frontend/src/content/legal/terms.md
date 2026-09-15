# Terms of Service for ELVA

**Effective version:** `2026-05-elva-v3`  
**Last updated:** May 3, 2026

---

## Preamble

ELVA is a **workspace product for conversational AI**: you can create **chat and voice agents**, connect **knowledge** and **catalog** data, operate **orders and leads**, use **analytics**, **campaigns**, and **alerts, notifications, and third-party integrations** (e-mail, Slack, calendars, CRMs, telephony, and similar connectors), all scoped to your **organization (tenant)**. These Terms set the legal framework for how you and your users may access, configure, depend on, and discontinue use of the Service. They are written to survive scrutiny in **B2B procurement**, **security reviews**, **data protection assessments**, and **revenue operations** environments, but **they are not a substitute for counsel**: regulated industries (health, finance, minors, government, telecom) should obtain advice tailored to your jurisdiction.

**Reading guide:** capitalized terms such as **“Service”**, **“Customer”**, **“User”**, and **“Subscription”** carry the meanings in the Definitions section. If you **create an account**, **accept an invite**, **log in with Google**, **call our APIs**, or **otherwise use the Service**, you agree to these Terms on behalf of yourself and (where applicable) the **legal entity** you represent.

---

## Definitions

| Term | Meaning |
|------|---------|
| **“Agreement”** | These Terms together with any **order form**, **statement of work**, **data processing addendum (“DPA”)**, **business associate agreement (“BAA”)** (if separately signed), **SLA** (if purchased), and **policies** incorporated by reference. |
| **“Customer”** | The company or individual that owns the **workspace** and subscription. |
| **“User”** | Any person authenticated into a workspace, including **administrators**, **members**, **guests**, or **service accounts** where supported. |
| **“Workspace”** | A logically isolated tenant containing **users**, **agents**, **documents**, **campaigns**, **connectors**, and **billing**. |
| **“Customer Content”** | Data you or your Users submit: files, structured records, prompts, recordings (if enabled), configuration, webhook payloads, and **metadata** derived therefrom. |
| **“ELVA Systems”** | Our software, infrastructure, APIs, documentation, and support interfaces. |
| **“Third-Party Services”** | Providers we integrate with or that you connect (e.g. **OpenAI**, **Anthropic**, **Google**, **Twilio**, **Stripe**, **SendGrid**, **vector DBs**, **object storage**, **Slack**). |
| **“Outputs”** | Text, audio, tool calls, recommendations, classifications, scores, or summaries produced by agents or models. |

---

## 1. Accounts, workspaces, identities, and roles

1. **Eligibility.** You represent that you are **legally able** to contract and that you are **not barred** from receiving the Service under export, sanctions, or anti-bribery laws. If you register on behalf of an organization, you represent **authority to bind** it.
2. **Registration types.** You may register as a **solo** workspace or a **company / team** workspace. We may enforce **email domain** rules for company workspaces to reduce fraud and align with **enterprise expectations**.
3. **Credentials & MFA.** You are responsible for **password strength**, **rotation where policy requires**, **OAuth token hygiene**, **API key custody**, and **promptly revoking** access for departing staff. Where we offer **multi-factor authentication**, administrators should enable it for high-privilege roles.
4. **Roles & least privilege.**  
   - **`business_admin` (workspace administrator)** may manage **billing**, **subscription**, **teammates**, **invitations**, **workspace settings**, **suspensions**, **audit visibility** (where productized), and **dangerous operations** surfaced in the UI.  
   - **`member`** uses the product subject to **in-product permissions** and **plan limits**. Members cannot perform actions the Service deliberately reserves to administrators unless we expressly allow.
5. **Invitations.** Invites are **sensitive**: valid links may allow account creation under your workspace. Administrators must treat invite URLs as **credentials**. ELVA may **expire** invites, **invalidate** them after use, or **rate-limit** issuance for abuse prevention.
6. **Suspension of Users.** Administrators may **suspend** a teammate’s login **without deleting** historical records **where the product supports it**. Suspended Users **cannot authenticate** until reactivated. We may **prevent** suspension patterns that would **lock out all** administrative control without recovery paths.
7. **No shared human identities.** Unless a feature explicitly supports **break-glass** or **support impersonation** (if ever offered under a separate agreement), Users must not share **individual** login credentials.

---

## 2. The Service, license, and restrictions

1. **Access grant.** Subject to these Terms and timely payment (if applicable), ELVA grants Customer a **non-exclusive, non-transferable (except as permitted herein)** right to access and use the Service for its **internal business purposes**.
2. **Scope of use.** You will use the Service consistent with **documentation**, **plan entitlements**, **fair use**, and applicable law. You will not:  
   - **Resell** or **time-share** the Service except as a **genuine service provider** to your affiliates or clients **if** we expressly permit that use case in writing;  
   - **Reverse engineer**, **decompile**, or **circumvent** technical limits except where **mandatory law** allows;  
   - **Probe**, **fuzz**, or **load-test** production endpoints **without** written authorization;  
   - **Mine** or **scrape** the Service to train **external** commercial models without permission;  
   - **Misrepresent** identity, **spoof** tenants, or **forge** JWTs or headers.
3. **API usage.** API access requires **valid credentials**. You must implement **retry budgets**, **exponential backoff**, **idempotency keys** where documented, and **secure storage** for secrets. We may apply **rate limits**, **quotas**, **concurrency caps**, and **new endpoint protections** without prior notice where required for stability, we will use **commercially reasonable** efforts to document such limits.
4. **Fair use & anti-abuse.** Even within numeric quotas, **atypical** usage (e.g. extreme fan-out webhooks, unbounded polling, pathological document ingestion) may be throttled or blocked. We may **suspend** workspaces presenting **security risk** or **law enforcement** exposure after **notice where safe and lawful**.
5. **Changes.** We may **modify** the Service (features, UI, APIs). We will not materially reduce **SLA-backed** commitments during a **prepaid term** **if** you purchased an SLA. Otherwise, our **Product** evolves, **backwards compatibility** is a goal, not a guarantee, except where **deprecation windows** are published for specific APIs.

---

## 3. Customer Content, licences, and responsibilities

1. **Your data remains yours** as between the parties, excluding **ELVA IP** embedded in Outputs’ **expression** of our software (e.g., templates) and **aggregated, de-identified** metrics we may derive for **telemetry** and **product improvement** according to our Privacy Policy.
2. **License to ELVA.** You grant ELVA a **non-exclusive, worldwide, royalty-free** licence to **host, reproduce, process, transmit, display (to You), create backups, secure, monitor, troubleshoot, and derive technical aggregates** solely to **provide, secure, and improve** the Service. **No** licence is granted to **sell** your confidential documents to third parties as standalone data products.
3. **Representations.** You represent you have **all rights** necessary to upload Customer Content and to **instruct** models to process it, including **consents** for **voice recording**, **biometric** processing (if applicable), **employee monitoring** (if applicable), and **cross-border** transfer mechanisms.
4. **Sensitive categories.** Unless we **explicitly agree in writing** (including supplementary agreements), you will **not** use the Service as a **primary system of record** for **regulated** categories beyond your own compliance design. You remain responsible for **lawful basis**, **data subject rights**, **record retention**, and **breach handling**.
5. **Prohibited content.** You will not submit **illegal** content, **malware**, **credentials of third parties** without authority, **CSAM**, **terrorist content**, or content designed to **jailbreak** or **evade** safety systems. We may **remove** or **block** processing and **cooperate** with authorities when required.

---

## 4. AI, Outputs, human review, and third-party models

1. **No professional advice.** Outputs may include **errors**, **hallucinations**, **overconfidence**, or **stale** facts. The Service is **not** a law firm, clinic, financial adviser, or licensed professional. **Human review** is required before **contractual commitments**, **clinical**, **safety-critical**, or **financial reporting** uses.
2. **Third-party models & endpoints.** Calls to external **LLMs**, **speech**, **embedding**, or **moderation** providers are governed by **their** policies plus **ours**. Pricing, logging, retention, and geography may differ per provider.
3. **Training & logging.** Unless we state otherwise in a **DPA** or **order**, we **do not** use your **private workspace documents** to train **foundational** third-party models **through ELVA’s integration path** except where a provider’s **default** enterprise setting applies, **verify** your provider configuration. We may store **prompt/response logs** for **debugging**, **billing**, **abuse review**, and **support** subject to **retention** limits.
4. **Safety & refusal.** We and upstream providers may **refuse**, **truncate**, **redact**, or **filter** prompts and Outputs to reduce **harms** and **policy violations**.
5. **Indemnity subset (Customer).** You will defend ELVA against claims arising from **your** reliance on Outputs **without** reasonable oversight, or **your** **misuse** of automation in regulated domains, except to the extent caused by ELVA’s **gross negligence** or **willful misconduct** (subject to liability caps below).

---

## 5. Messaging, voice, SMS, email, and recording

1. **Compliance stack.** Where features touch **telephony**, **SMS**, **email**, or **recording**, you are solely responsible for **consent**, **disclosure**, **opt-in/opt-out**, **do-not-call** lists, **time windows**, **identification**, **accessibility**, and **recordkeeping** under **TCPA**, **CTIA**, **CAN-SPAM**, **CASL**, **GDPR/ePrivacy**, **PECR**, **CPRA**, **LGPD**, and **local** telecom rules.
2. **Truthful origination.** You will not **spoof** sender IDs, **mislabel** AI as human where **disclosure** is required, or **conceal** **commercial** intent where law requires **plain** identification.
3. **Recordings & transcripts.** If you enable recording, you warrant **lawful notice** to participants. Retention, redaction, and **subject access** requests for recordings are **Customer’s** operational burden unless separately contracted.
4. **Carrier & deliverability.** Third-party **filters**, **blocklists**, and **carrier policies** may affect delivery, **not** an ELVA defect unless an **SLA** expressly covers it.

---

## 6. Billing, taxes, trials, credits, and refunds

1. **Plans & limits.** Features may be **metered** by **seats**, **messages**, **minutes**, **documents**, **agents**, **API calls**, **connector runs**, **storage**, or **ingress/egress**. Overage may incur **additional charges** or **hard stops** depending on **plan configuration**.
2. **Payment processing.** We use **payment processors** (e.g. **Stripe**). **Card** failures may lead to **grace periods** then **suspension**. You authorize **recurring** charges where you choose subscriptions.
3. **Taxes.** Fees are **exclusive** of taxes unless stated. You will pay **VAT**, **GST**, **sales**, **withholding** (if applicable), and **duties**.
4. **Trials & credits.** Promotional credits **expire** as stated. **No** cash redemption except where **law** mandates.
5. **Refunds.** Unless mandatory consumer law requires otherwise, **fees are non-refundable** for partial months, **exceptions** may appear on an **order form**.
6. **Price changes.** We may change **list prices** with **notice**; **renewal** pricing may differ from **initial** promotional pricing.

---

## 7. Confidentiality, security, audits, and subprocessors

1. **Confidential Information** means non-public information disclosed by either party marked or reasonably understood as confidential.
2. **Obligations.** Receiving party uses **reasonable care**, **no less than** sensible industry practices, and limits use to **Agreement purposes**.
3. **Security.** We implement **administrative**, **technical**, and **physical** controls appropriate to **risk**. **Summaries** in marketing or this document **do not** waive **warranties disclaimers** below.
4. **Subprocessors.** We may use **subprocessors** listed or categorized in our **documentation** / **privacy materials**. We remain **responsible** for their performance **to you** as **our** delegates.
5. **Customer audits** (non-regulatory): reasonable **security questionnaires** and **evidence** requests may be accommodated **once per year** (unless a **DPA** states more) with **reasonable notice** and **fees** for **onsite** or **extraordinary** audits.
6. **Incidents.** If we become aware of a **breach** of ELVA-managed systems affecting **Customer Content**, we will **notify** you **without undue delay** consistent with **investigation** needs and **law**, and provide **supporting** information to assist **your** regulatory duties.

---

## 8. Data locations, retention, export, and deletion

1. **Regions** may be **designated** in **deployment** configuration or contracts. **Not** every subsystem guarantees **single-region residency** unless **expressly** sold that way.
2. **Backups** are **encrypted** in typical production templates; **retention** exceeds live deletion for **disaster recovery** windows.
3. **Deletion** requests are honored **subject to** **legal holds**, **billing** requirements, **audit** obligations, and **technical** residual traces in **backups** that **age out**.
4. **Export** tools are provided **as available**; **complex graphs** (relations, embeddings) may require **professional services** for full portability.

---

## 9. Intellectual property, feedback, and open-source

1. **ELVA IP.** We retain **all rights** to the Service, **documentation**, **logos**, and **templates**, excluding **your** **Customer Content** and **your** **trademarks** you provide.
2. **Feedback.** If you **offer** suggestions, you grant ELVA a **royalty-free**, **irrevocable** licence to use feedback **without** attribution or payment, **excluding** patent grants beyond what **law** implies.
3. **Open-source** components may be used under **their** licences; **no** viral licence infects **your** proprietary Customer Content **merely** by storing it on ELVA unless you **distribute** derived works of such OSS in a manner that triggers copyleft, **unlikely** in ordinary SaaS usage.

---

## 10. Warranties disclaimer

THE SERVICE AND ALL OUTPUTS ARE PROVIDED **“AS IS” AND “AS AVAILABLE.”** TO THE **MAXIMUM** EXTENT PERMITTED BY LAW, ELVA DISCLAIMS **ALL WARRANTIES**, WHETHER **EXPRESS**, **IMPLIED**, **STATUTORY**, OR OTHERWISE, INCLUDING **MERCHANTABILITY**, **FITNESS FOR A PARTICULAR PURPOSE**, **TITLE**, **QUIET ENJOYMENT**, AND **NON-INFRINGEMENT**. ELVA DOES **NOT** WARRANT **UNINTERRUPTED** SERVICE, **ERROR-FREE** OUTPUTS, **SPECIFIC** LATENCY, OR **COMPATIBILITY** WITH **EVERY** THIRD-PARTY INTEGRATION YOU IMAGINE.

---

## 11. Limitation of liability

TO THE **MAXIMUM** EXTENT PERMITTED BY LAW:

1. **No indirect damages.** NEITHER PARTY IS LIABLE FOR **INDIRECT**, **INCIDENTAL**, **SPECIAL**, **CONSEQUENTIAL**, **EXEMPLARY**, OR **PUNITIVE** DAMAGES, OR **LOSS OF PROFITS**, **REVENUE**, **GOODWILL**, **DATA** (EXCEPT WHERE **DATA LOSS** IS CAUSED BY OUR **GROSS NEGLIGENCE** AND **BACKUP** SERVICES WERE **INCLUDED** AND **FAILED**), **ANTICIPATED SAVINGS**, OR **BUSINESS INTERRUPTION**.
2. **Cap.** ELVA’S **AGGREGATE** LIABILITY FOR **ALL** CLAIMS IN ANY **12-MONTH** PERIOD IS LIMITED TO **THE FEES YOU PAID ELVA** IN THE **12 MONTHS** BEFORE THE EVENT (OR **USD $100** IF **FREE**).
3. **Exceptions.** LIMITS **DO NOT** APPLY TO **EITHER PARTY’S**: (a) **fraud** or **willful misconduct**; (b) **death/personal injury** from **gross negligence** where **law** forbids limitation; (c) **your** **payment** obligations; (d) **your** **indemnity** for **IP infringement** caused by **your** **Customer Content**; (e) **breach** of **export** or **sanctions** compliance **by you**.

---

## 12. Indemnification

1. **By ELVA (IP).** ELVA will defend you against claims that the **ELVA-branded Service**, **unmodified** as delivered, **infringes** a third party’s **patent**, **copyright**, or **trade secret**, and pay **court-awarded** damages or **settlement** **ELVA approves**, **if** you **promptly** notify us, **allow** control, and **cooperate**. **Remedies** may include **substitution**, **workaround**, or **refund** of **prepaid** fees **after termination**, this is **your exclusive** remedy for **infringement** unless **law** forbids.
2. **By Customer.** You will defend ELVA against claims arising from (a) **Customer Content**; (b) **your** **messaging/compliance** failures; (c) **your** breach of these Terms; (d) **disputes** between **you** and **your** customers **attributed** to **your** **configuration**, **prompting**, or **agent behavior** **absent** ELVA’s **written** **co-branding** as **controller** of that behavior.

---

## 13. Term, suspension, and termination

1. **Term** follows **subscription period** or **order**.
2. **Suspension** for **non-payment**, **abuse**, **legal** process, or **material** risk may occur **with or without** prior notice depending on **severity**.
3. **Effect of termination**, access **ends**; we may **delete** data after **export windows** published in **docs** or **orders**. **Sections** that **should survive** (IP, confidentiality where applicable, disclaimers, limits, governing law) **survive**.

---

## 14. Export, sanctions, and anti-corruption

You will comply with **export controls**, **sanctions**, and **anti-bribery** laws (e.g. **FCPA**, **UK Bribery Act**). You **represent** you are **not** a **blocked** person or **located** in a comprehensively sanctioned country **where** prohibited.

---

## 15. Government & enterprise supplemental

If you are a **U.S. federal** agency or similar, **FAR/DFARS** flow-downs apply **only** if **explicitly** executed in a separate **government schedule**. Commercial **off-the-shelf** terms govern otherwise.

---

## 16. Beta, previews, and experimental features

**Preview** or **beta** features may be **unstable**, **unpriced**, or **withdrawn**. **SLAs** and **SLAs’ credits** **do not** apply to **betas** unless the **beta** invitation **states** otherwise.

---

## 17. Professional services & custom development

**Statements of Work** govern **custom** engineering. Unless stated, **deliverables** are **licensed** like the Service (**non-exclusive** to you for **internal** use) excluding **pre-existing** ELVA IP.

---

## 18. Publicity

Neither party may **issue a press release** naming the other **without** consent. **ELVA** may list **your** **name** and **logo** as a **customer** on **our** site **unless** you **opt out** via **support**.

---

## 19. Assignment & successors

Neither party may **assign** without consent except to an **successor** in a **bona fide** **merger**, **acquisition**, or **asset sale** with **notice**. **ELVA** may assign to **affiliates**.

---

## 20. Force majeure

Neither party is liable for delay due to **events beyond reasonable control**, including **outages of public cloud**, **strategic** **third-party API** changes, **labor disputes**, **natural disasters**, **acts of government**, **war**, **pandemics**, or **Internet** congestion, **payment** obligations **survive**.

---

## 21. Notices

Notices to ELVA go to addresses in **product** or on **your** **order**. **Email** notice is acceptable unless **law** requires otherwise. You keep **billing contacts** accurate.

---

## 22. Dispute resolution & governing law

Unless a **separate** **jurisdiction clause** in an **order** applies, these Terms are governed by the laws of **Delaware**, USA (excluding **conflict** rules). **Courts** in **Delaware** have **exclusive venue**, subject to **mandatory consumer** rights in **your** country if **non-waivable**.

---

## 23. Severability & entire agreement

If a clause is **invalid**, the **remainder** **continues**. These Terms and any **order** form constitute the **entire agreement** on the **Service**, superseding **prior** oral statements **on the same subject**, **except** **fraud** or **misrepresentation**.

---

## 24. Changes to these Terms

We may **update** these Terms. **Material** changes will be communicated via **UI**, **email**, or **docs**, and tracked via **`termsVersion`**. **Continued use** after an effective date may constitute **acceptance** where **permitted**. If you **reject**, your **remedy** is to **export** (if available) and **terminate**.

---

## 25. Contact

**Support & legal notices:** use the in-product channel or the contact address on your ELVA deployment’s site.

---

*These Terms support ELVA product deployments for informational purposes. Obtain review by qualified counsel before relying on them in regulated, high-liability, or cross-border contexts.*
