import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { ProfilePhotoUpload } from '../../components/ProfilePhotoUpload';

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState({ type: '', msg: '' });

  const [settings, setSettings] = useState({
    directory_release: true,
    communications_opt_in: true,
    photo: null as string | null
  });

  useEffect(() => {
    api.student.getSettings()
      .then(data => {
        setSettings({
          directory_release: Boolean(data.directory_release),
          communications_opt_in: Boolean(data.communications_opt_in),
          photo: data.photo || null
        });
      })
      .catch(e => {
        setAlert({ type: 'danger', msg: e.message || 'Failed to load settings' });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setAlert({ type: '', msg: '' });
    try {
      await api.student.updateSettings(settings);
      setAlert({ type: 'success', msg: 'FERPA privacy & communication preferences updated successfully.' });
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to update settings' });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (base64: string) => {
    try {
      await api.student.updatePhoto(base64);
      setSettings(s => ({ ...s, photo: base64 }));
      setAlert({ type: 'success', msg: 'Profile photo updated successfully.' });
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to update photo.' });
      throw e;
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <div className="spinner" style={{ width: 40, height: 40 }}></div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      
      {/* ─── Header Section ─── */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2rem', color: 'var(--navy)', marginBottom: '0.25rem', fontWeight: 900 }}>
          ⚙️ Student Account & Privacy Settings
        </h1>
        <p style={{ color: 'var(--slate)', fontSize: '0.95rem' }}>
          Manage FERPA privacy preferences, profile photo, and notification options.
        </p>
      </div>

      {alert.msg && (
        <div className={`alert alert-${alert.type}`} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{alert.msg}</span>
          <button onClick={() => setAlert({ type: '', msg: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {/* ─── Profile Photo Card ─── */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.2rem', color: 'var(--navy)', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
          Official Profile Photo
        </h2>
        <ProfilePhotoUpload
          currentPhoto={settings.photo}
          onUpload={handlePhotoUpload}
          buttonClass="btn btn-outline btn-sm"
        />
      </div>

      {/* ─── FERPA & Preferences Card ─── */}
      <div className="card">
        <form onSubmit={handleSave}>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.2rem', color: 'var(--navy)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              FERPA Directory Information Release
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              The Family Educational Rights and Privacy Act (FERPA) allows the university to release "Directory Information" (name, program, dates of attendance) without prior consent unless you explicitly opt out.
            </p>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', cursor: 'pointer', background: 'var(--bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <input
                type="checkbox"
                checked={settings.directory_release}
                onChange={e => setSettings(s => ({ ...s, directory_release: e.target.checked }))}
                style={{ marginTop: '0.25rem', width: 18, height: 18 }}
              />
              <div>
                <strong style={{ color: 'var(--navy)', fontSize: '0.95rem', display: 'block', marginBottom: '0.15rem' }}>
                  Authorize Directory Information Release
                </strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--slate)' }}>
                  Allow BMI University to include your name and graduation standing in campus honors directories.
                </span>
              </div>
            </label>
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.2rem', color: 'var(--navy)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              Campus Communications
            </h2>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', cursor: 'pointer', background: 'var(--bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <input
                type="checkbox"
                checked={settings.communications_opt_in}
                onChange={e => setSettings(s => ({ ...s, communications_opt_in: e.target.checked }))}
                style={{ marginTop: '0.25rem', width: 18, height: 18 }}
              />
              <div>
                <strong style={{ color: 'var(--navy)', fontSize: '0.95rem', display: 'block', marginBottom: '0.15rem' }}>
                  Receive Academic Announcements & Alerts via Email
                </strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--slate)' }}>
                  Receive important notifications regarding class schedules, grade releases, and billing statements.
                </span>
              </div>
            </label>
          </div>

          <button type="submit" className="btn btn-gold" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </div>

    </div>
  );
}
