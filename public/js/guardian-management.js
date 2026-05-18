// public/js/guardian-management.js
async function getGuardians(childId) {
  const tokenEl = document.getElementById('token');
  const headers = {};
  if (tokenEl && tokenEl.value.trim()) {
    headers['Authorization'] = 'Bearer ' + tokenEl.value.trim();
  }
  const res = await fetch(`/api/v2/guardians/children/${encodeURIComponent(childId)}/guardians`, { headers });
  return res.json();
}

document.addEventListener('DOMContentLoaded', () => {
  const loadBtn = document.getElementById('load');
  const childInput = document.getElementById('childId');
  const list = document.getElementById('guardiansList');

  loadBtn.addEventListener('click', async () => {
    list.innerHTML = '';
    const childId = childInput.value.trim();
    if (!childId) return alert('Enter childId');
    const json = await getGuardians(childId);
    if (!json.success) return list.innerText = JSON.stringify(json);
    const ul = document.createElement('ul');
    for (const g of json.guardians) {
      const li = document.createElement('li');
      li.innerText = `${g.name || g.email || g.guardianId} — ${g.role} — ${g.status}`;
      ul.appendChild(li);
    }
    list.appendChild(ul);
  });
});
