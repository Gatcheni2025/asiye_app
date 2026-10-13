# Asiye Launch Readiness — 13 October 2026
Owner: Asiye release and operations team. **Status: controlled pilot only; no approval for wide public campaigns yet.**

## Evidence checked
- Release source: `fix/11.0.67-club-booking-arrival-pin-timer`, `11.0.71+341` (app source); `main` is still older at `11.0.49+319`. Release branch must be selected explicitly until safely integrated.
- Android CI: **PASS** — signed APK and AAB (artifacts `asiye-11.0.71-341-apk` and `asiye-11.0.71-341-aab`). https://github.com/Gatcheni2025/asiye_app/actions/runs/38239996199
- iOS CI: **PASS** — signed iOS version `46522.0.0 (93124)` uploaded to App Store Connect 12 Oct 2026. This **does not** establish that App Review approved/publicly distributed build 93124. https://github.com/Gatcheni2025/asiye_app/actions/runs/38260469171
- Firebase: **PASS** — scoped Go pickup PIN and protected settlement functions deployed, with test/endpoint validation. https://github.com/Gatcheni2025/asiye_app/actions/runs/38240205774
- Public presence: Google Play https://play.google.com/store/apps/details?id=com.asiyeapp.asiye ; Apple https://apps.apple.com/za/app/asiye/id6765691149 ; website https://asiye.cloud/ and https://www.asiye.cloud/
- Known outstanding GitHub issues: #17 and #18 concern Club booking sync, countdown, notifications and timeout negotiations. They are open; their closure is not proof of a fix and tested code is not proof of live-device acceptance.

## Hard go / no-go gates (must be evidenced, not assumed)
1. **Legal approval** — confirm platform/app NPTR registration and current statutory requirements for the platform, drivers, operating licences and vehicle safety. Verify applicable provincial requirements and keep certificates/audit trail; consult SA transport specialist before passenger services at scale. The NLTA amendments effective 12 Sept 2025 create concrete obligations. See https://www.gov.za/news/media-statements/transport-gazettes-national-land-transport-amendment-act-and-regulations-e and https://www.saflii.org/za/legis/consol_act/nlta5o2009277/ .
2. **Approved drivers** — confirm each pilot driver/vehicle is verified and licensed, with vehicle/driver identity matching passenger booking information; no unapproved vehicle dispatched. Verify emergency response measures and local rules including physical panic button obligations.
3. **Android public release** — confirm Google Play Console **Production** release uses actual app `versionCode 341` and is approved/available to the intended South African users; artifacts alone are not distribution.
4. **iOS public release** — confirm build `46522.0.0 (93124)` has processed successfully in App Store Connect, passes TestFlight on real devices, is selected in the version record, submitted for App Review, approved and made available. TestFlight upload is not production.
5. **Real device journeys in target operating zones** — use physical Android+Android, iOS+iOS and Android+iOS driver/passenger pairs. Collect videos, request IDs, and real payment reconciliation evidence; test real GPS/FCM, not solely synthetic API requests.
6. **Go cash** — reserve driver, driver arrives, PIN verified before moving, share optional/WhatsApp return works, cash requested only after destination, no second PIN, no double driver earnings. Test app termination and network loss.
7. **Go wallet/card/voucher** — payment verified at agreed fare before departure (held as designed), cancelled booking reverses hold where appropriate, capture/settlement occurs once, Paystack return resumes correct booking, no money lost on retry.
8. **Work/Club** — 30 minute countdown synchronized across passengers and driver; waiting alerts and pickup/destination details; unfilled timeout enters valid negotiation; multiple PIN verifications before departure; no payment double-capture. Include full group, underfilled, passenger cancellation and failure-to-connect.
9. **Safety & data** — trip restoration on both roles; background location and tracking link access/expiry/revocation; emergency escalation; profile/document access controls; POPIA notices, data deletion request and consent for direct marketing.
10. **Operations** — staffed support, approved driver onboarding queue, real-time incident escalation, failed payment reconciliation, refunds, cancellation policy, published customer care contact, outage/rollback owner. Check admin portal access and logs.
11. **Quality** — verify Flutter analyzer issues are triaged. Android workflow currently uses `continue-on-error: true` for `flutter analyze`; a green build alone doesn't prove clean analysis. Review crash monitoring, minimum supported OS, device compatibility.
12. **Accurate public copy** — reconcile current driver fees and commissions on website and both stores. Apple listing indexed with 0% commission/flat monthly subscription, while current booking tests use 20% trip commission. Google Play description still speaks of public-taxi queues. Validate/strip unsupported website scale, earnings, testimonial, insurance and 24/7 support claims. Ensure `asiye.cloud` and `www.asiye.cloud` resolve consistently to the approved site.

## Recommended real-device pilot acceptance (targets, not measured performance)
- Controlled pilot in **one Durban corridor/zone** with enough online licensed and approved drivers, staffed support and real demand; do not advertise across the country while supply is thin.
- Run documented booking lifecycle trials with all supported payment methods and cross-platform pairings; record actual pass/fail plus evidence.
- No departure with bad/absent PIN, no unlicensed/unapproved dispatch, **zero unexplained charges, duplicated payments or ledger mismatches**, no unaddressed safety incident.
- Set service targets before launch (suggestion only): ≥95% of eligible booking attempts reach a clear outcome, ≥99% crash-free sessions, majority of requests matched quickly in pilot hours, and every test payment reconciled.
- Pilot expansion is conditional on passing test scenarios, regulatory sign-off and staffed operations; no fixed calendar promise.

## Online acquisition funnel (launch in phases)
**Week 0 / prelaunch:** repair store listing descriptions and screenshots; display both official store badges on a canonical mobile landing page; install app/driver CTA, transparent coverage map and real support contact. Use one QR per target zone and campaign-coded links; instrument store clicks, installations, registrations, verified drivers, ride requests, acceptances, completed rides, payment completion, support cases, refunds and weekly rider repeat rate.
**Phase 1 / driver supply:** recruit and verify enough drivers for a bounded zone, via current driver network and opted-in ambassador referrals. Run driver onboarding help sessions and verify that drivers can go online and accept/pickup.
**Phase 2 / rider invitation:** open an invitation pilot for opted-in commuters/contacts in the same zone; use local WhatsApp communities, Facebook/Instagram/TikTok short live-demo clips and QR posters. Lead with Asiye Go and PIN/live share. Explain Work/Club as shared commute with potential wait/negotiation; don't guarantee instant seats or savings before evidence.
**Phase 3 / paid demand:** small geo-targeted campaigns only where drivers are online; use weekly funnel dashboard to evaluate cost per completed first trip, conversion, successful trip rate and repeat bookings; pause promotion if failed requests/support backlog rises.
**Phase 4 / expansion:** repeat by suburb/corridor then city after quality metrics, platform registration and driver supply are proven. Avoid broad national claims until active coverage is real.

## Daily launch scoreboard
Date / zone / approved online drivers at peak / install clicks / new registrations / first bookings / accepted / completed rides / cancellations / payment issues / cash reconciliation issues / refunds / median pickup ETA / PIN failures / safety alerts / support backlog / repeat riders / spend / cost per completed first ride.

## Immediate owner questions
- Do Asiye the platform and the drivers already have the **required NPTR and provincial operating approvals**?
- In Google Play Console, is Android **341** approved and currently in Production?
- In App Store Connect, is **46522.0.0 (93124)** processed and TestFlight-tested, and has that build been submitted/approved for public distribution?
- Which exact Durban area will be first, and how many **verified, licensed, active online drivers** are available there during initial pilot hours?
