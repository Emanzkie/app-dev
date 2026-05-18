import React, { useEffect, useState } from 'react';

export default function GuardianManagement() {
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [guardians, setGuardians] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [message, setMessage] = useState(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  useEffect(() => {
    if (!token) return;
    fetch('/api/children', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.children)) setChildren(data.children);
        else setChildren([]);
      })
      .catch((err) => console.warn('Failed to load children', err));
  }, [token]);

  useEffect(() => {
    if (!selectedChild) return;
    if (!token) {
      setMessage('Please log in to manage guardians.');
      return;
    }

    fetch(`/api/v2/guardians/children/${selectedChild}/guardians`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setGuardians(data.guardians || []);
      })
      .catch((err) => console.warn('Failed to load guardians', err));
  }, [selectedChild, token]);

  async function handleInvite(e) {
    e.preventDefault();
    setMessage(null);
    if (!selectedChild) return setMessage('Select a child first.');
    if (!inviteEmail) return setMessage('Enter an email to invite.');
    try {
      const res = await fetch('/api/v2/guardians/generate-invitation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ childId: selectedChild, inviteEmail }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setMessage(body.invitationCode ? `Invitation created. Code: ${body.invitationCode}` : 'Invitation created.');
        setInviteEmail('');
        // refresh guardian list
        setTimeout(() => setSelectedChild((c) => (c ? c : '')), 500);
      } else {
        setMessage(body.error || JSON.stringify(body));
      }
    } catch (err) {
      console.error(err);
      setMessage('Failed to create invitation.');
    }
  }

  async function handleRevoke(guardianId) {
    if (!selectedChild) return;
    if (!confirm('Revoke access for this guardian?')) return;
    try {
      const res = await fetch(`/api/v2/guardians/children/${selectedChild}/guardians/${guardianId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (res.ok) {
        setMessage('Guardian revoked.');
        setGuardians((g) => g.filter((x) => x.id !== guardianId));
      } else {
        setMessage(body.error || JSON.stringify(body));
      }
    } catch (err) {
      console.error(err);
      setMessage('Failed to revoke guardian.');
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 900 }}>
      <h2>Guardian Management</h2>
      {!token && <div style={{ color: 'darkred' }}>You must be logged in to manage guardians.</div>}

      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>Select Child</label>
        <select value={selectedChild} onChange={(e) => setSelectedChild(e.target.value)} style={{ padding: 8, minWidth: 320 }}>
          <option value="">-- Select a child --</option>
          {children.map((c) => (
            <option key={c._id || c.id} value={c._id || c.id}>
              {c.firstName} {c.lastName}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleInvite} style={{ marginTop: 16 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>Invite by email</label>
        <input
          type="email"
          placeholder="guardian@example.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          style={{ padding: 8, minWidth: 320 }}
        />
        <button style={{ marginLeft: 8, padding: '8px 12px' }} type="submit">
          Send Invite
        </button>
      </form>

      <div style={{ marginTop: 20 }}>
        <h3>Current Guardians</h3>
        {guardians.length === 0 ? (
          <div>No guardians found for this child.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 8 }}>Name</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Role</th>
                <th style={{ padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {guardians.map((g) => (
                <tr key={g.id}>
                  <td style={{ padding: 8 }}>{g.name || '—'}</td>
                  <td style={{ padding: 8 }}>{g.email || '—'}</td>
                  <td style={{ padding: 8 }}>{g.role || '—'}</td>
                  <td style={{ padding: 8 }}>
                    <button onClick={() => handleRevoke(g.id)} style={{ padding: '6px 10px' }}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {message && (
        <div style={{ marginTop: 18, padding: 8, background: '#f6f6f6', borderRadius: 6 }}>{message}</div>
      )}
    </div>
  );
}
