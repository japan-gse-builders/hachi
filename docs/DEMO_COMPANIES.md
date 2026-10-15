# Company demo and patient call schedules

## Run the local demo

```sh
npm ci
npm run preview:local -- 5196
```

Open `http://127.0.0.1:5196/staff`. No cloud credentials are needed. The preview uses an in-memory
API, fictional identities, and no outbound services. Restarting it resets all demo edits.
The identity controls exist only in this local harness; the deployed app still uses Firebase sign-in.

| Company | Core team | Patients |
| --- | --- | --- |
| Sakura Home Care | Aiko Tanaka, Kenji Mori, Yuki Sato, Emma Wilson | 5 |
| Midori Community Care | Naomi Fujita, Daniel Kim, Hana Ito, Ryo Matsuda | 5 |
| Harbor Care Partners | Sophie Chen, Daichi Yamamoto, Maya Patel, Oliver Reed | 5 |

Each company has an owner, an admin, and two members. Patients have assigned staff, distinct daily
call times, seven days of fictional completed calls, and a mixture of concerns and healthy check-ins.
One patient per company has calls paused. Healthy check-ins do not get triage cases.

The preview starts as Aiko, who also has admin access to the other two companies. Use the company
selector in the header to switch between them. **Team** lists that company's employees. The
**View as** control at the top can switch to any of the twelve fictional employees; regular members
belong only to their own company. Aiko appears as an additional admin in the partner companies.

## Try the daily call schedule

1. As Aiko, choose **Sakura Home Care**, then **Patients**.
2. Choose **Change call time** on Margaret Ellis. In **Daily call schedule**, change 08:30 to 09:45
   and select **Save call time**. The panel identifies the patient's time zone (Japan time here).
3. Reload the page, then return to Patients. Margaret should show 09:45; Arthur should still show
   10:00. The time is saved through the same API used in production.
4. Choose **Yuki Sato** in **View as**. Yuki can change Dorothy Ishii's schedule because Dorothy is
   assigned to Yuki. Margaret's schedule is visible but cannot be edited by Yuki. Admins can change
   any patient in their company.
5. On **Add patient** and **Edit details**, the call-time field also uses a time picker.

For real patients, the existing scheduler reads each patient's saved time and time zone every
minute. Changes apply to future scheduling; already queued or ongoing calls are not canceled.
Saving a time does not resume paused calls, bypass first-use approval, or trigger an immediate call.
Synthetic demo patients are excluded from scheduling and dialing, and do not have dialable numbers.

## Add the fictional companies to a hosted demo

This is a separate operator action; running the web deployment does not add demo records.
First preview the dataset locally, without Google Cloud access:

```sh
npm run demo:companies
```

A project operator with access to Firebase Auth and Firestore can then run:

```sh
gcloud auth application-default login
npm run demo:companies -- --project YOUR_PROJECT_ID --viewer-email YOUR_VERIFIED_EMAIL --apply
```

Use the exact project that hosts the app's API and Firestore database. The viewer must already have
an enabled, email-verified Firebase account in that project. The script adds admin memberships for
that account in the three demo companies. It does not change existing organizations or memberships.
Afterward, reload Hachi and choose a demo company in the header.

The script creates only missing documents, using stable IDs and a `demoSeed: hachi-companies-v1`
marker. Repeating it preserves edits such as call times and roles. A collision with an existing
document without that marker aborts the whole transaction. It never deletes data.

Hosted demo organizations remain unverified, all patients are synthetic, phone numbers are empty,
and fictional employees use `.example.invalid` email addresses. History is imported and already
analyzed, with no recording URLs, pending analysis, notifications, or outbox work. The script
creates no Firebase Auth accounts and sends no invitations, emails, or calls. Fictional employees
are directory entries; the local **View as** control is not available on the hosted app.
