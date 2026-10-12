# Issue #17: queue filters, overview and resident context

Branch: `codex/issue-17-queue-context`. Based on main `7f21141`.

The running local preview is at <http://127.0.0.1:5190/staff>.
It runs the actual web pages and API against an in-memory store with fictional residents.
Authentication is replaced only in this local preview. No cloud credentials, real phone calls,
notification delivery or outbound workers are used. **Reset demo** restores the initial data.

## Try these changes

1. Open the queue. The overview should show **3 Need attention**, **2 Keeping an eye on**,
   and **6 Residents registered**. These count open cases, not individual people requiring action;
   registered residents includes inactive/pending residents too.
2. Select **Immediate action**. Only Edith should remain, and the nearby sentence explains
   the selected urgency. The URL should gain `urgency=emergency`.
3. Search **Dorothy** while Immediate action is selected. You should see **No cases match these
   filters** and a **Show all open cases** button. Use it to clear the conditions.
4. Search **breakfast**. Dorothy's case should appear because its summary contains that text.
   Searching a resident name works too; text matching ignores case. Select **Clear filters**.
5. Select **Include closed cases**. There should now be six case cards, including Arthur's earlier
   closed case. The overview still shows 3 / 2 / 6, because it counts open cases across all filters.
6. Search **Arthur** with closed cases included. Two cards should appear. Copy the current URL
   into another tab or reload it: the search, urgency and closed-case selection should survive.
7. Clear filters and open Margaret's case. **About this person** shows household, support, care
   needs, the fictional recorded arthritis and the assigned care team's contact details.
8. Compare Margaret's initials/colour in the queue and case page, then reload. They should be
   consistent. The synthetic-demo label must stay visible. The queue no longer prints resident IDs.
9. Use Tab / Shift+Tab to reach urgency buttons, search, the closed-case checkbox, reset and case
   links. Space selects a button or checkbox; Enter opens a focused case link. Focus is visible.
10. Narrow the window to phone size. Cards should remain readable, with consistent sizing on
    desktop; filters and summary blocks stack on small screens without page overflow.

The filters preserve the core's priority order. Urgency descriptions come from the same localized
API wording as the legend/case page. Service notices, unanswered calls and incomplete analyses
remain visible when you filter cases. The overview counts open cases even when closed cases are shown.

Hachi does not currently collect an age or birth date. This change uses household/support facts
already recorded, and does not infer ages or add new demographic fields. “None recorded” does not
claim that a person has no medical conditions.

## Restart the local preview

From this branch's root, using Node 22.12+:

```sh
npm ci --registry=https://registry.npmjs.org --no-audit --no-fund
npm run preview:local
```

The default port is 5190. Use `npm run preview:local -- 5192` for another port.

## Automated verification

```sh
npm run check
npm run build
npm run build --workspace @hachi/web
```

API tests cover open/closed selection, count semantics, preserved priority, person context,
query validation and staff authorization. Frontend tests cover combined/literal/normalized searches,
URL values, empty results and stable initials/colours. The Firestore emulator suite requires a
running emulator; it is skipped during ordinary local checks.

Completed checks: 1,189 tests passed; 13 Firestore-emulator tests skipped. Coverage thresholds
passed (99.63% lines; 95.66% branches), along with typechecking and service/web builds.
Headless-browser checks passed for filtering/search, closed cases, overview counts, URL reload,
resident context, stable initials/colours and keyboard controls. Queue/case/residents layouts
were checked at 1440, 1024, 900, 768, 390 and 320px (18 page/width combinations) with no page overflow
and equal desktop collection-card sizes.
