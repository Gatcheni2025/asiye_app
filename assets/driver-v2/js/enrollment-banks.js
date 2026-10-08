/* Universal branch codes for common South African payout accounts.
   Bank names are deliberately not Paystack transfer-recipient codes. */
(() => {
  const banks = [
    ['Absa','632005'],['Access Bank','410105'],['African Bank','430000'],
    ['Bank Zero','888000'],['Bidvest Bank','462005'],['Capitec Bank','470010'],
    ['Capitec Business','450105'],['Discovery Bank','679000'],
    ['FNB / First National Bank','250655'],['GoTyme / TymeBank','678910'],
    ['Investec','580105'],['Nedbank','198765'],['Postbank','460005'],
    ['Standard Bank','051001']
  ];
  const bank = document.getElementById('enrollmentBank');
  const branch = document.getElementById('enrollmentBranchCode');
  if (!bank || !branch) return;
  for (const [name,code] of banks) {
    const option = document.createElement('option');
    option.value = name;
    option.dataset.branchCode = code;
    option.textContent = name;
    bank.append(option);
  }
  bank.addEventListener('change', () => {
    branch.value = bank.selectedOptions[0]?.dataset.branchCode || '';
    branch.dispatchEvent(new Event('input',{ bubbles:true }));
  });
  window.AsiyeEnrollmentBanks = { banks };
})();