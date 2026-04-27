(function() {
  'use strict';
const defaults = {company:"대무 (DAEMU)",email:"daemu_office@naver.com",phone:"061-335-1239",addr:"전라남도 나주시 황동 3길 8"};
const info = JSON.parse(localStorage.getItem("daemu_siteinfo") || "null") || defaults;
document.getElementById("s-company").value = info.company;
document.getElementById("s-email").value = info.email;
document.getElementById("s-phone").value = info.phone;
document.getElementById("s-addr").value = info.addr;
function saveSiteInfo() {
  localStorage.setItem("daemu_siteinfo", JSON.stringify({
    company: document.getElementById("s-company").value,
    email: document.getElementById("s-email").value,
    phone: document.getElementById("s-phone").value,
    addr: document.getElementById("s-addr").value,
  }));
  alert("저장되었습니다.");
}


Object.assign(window, { saveSiteInfo });
})();
