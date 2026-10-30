# Vehicle illustrations and bank verification funding

Prepared source changes; not deployed or included in the installed 352 packages.

Passenger driver-match and pickup cards use original animated SVG car artwork rather than the uploaded car photo. Toyota + Corolla (including Quest) selects the Corolla illustration; other models use a generic vehicle illustration. Known recorded colours use a fixed palette, unknown colours use silver. This is a stylized illustration, not an exact model-year rendering. Registration plate, vehicle description and driver portrait remain visible. Reduced-motion preference disables animation. Actual car photos remain required and stored for enrollment/admin approval.

The banking page translates insufficient balance/funds provider errors into an Asiye service-funding message. It does not charge drivers, enable a wallet, bypass verified banking, or mark an account verified. Asiye's Paystack secret is used for POST /bank/validate, so Paystack's charge is against Asiye's balance, not the driver's bank balance. Paystack lists ZAR 3 per successful API request regardless of the validation result; 250 requests cost R750 before retries. Asiye must fund its provider balance privately, or separately design and disclose a driver-paid verification product. No such driver fee was implemented.

Sources: https://support.paystack.com/en/articles/2130818 and https://paystack.com/docs/identity-verification/verify-account-number/ (checked 30 October 2026).

Validation: JavaScript syntax checks and 24 tests covering illustration selection, hostile input, retained identity/plate, payout protections, bank-owner proof and request-search behavior passed. No production deployment, mobile store upload, real verification charge or new fee was performed.
