// src/pages/DriverApp.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth }   from '../context/AuthContext';
import { driversApi, inspApi, jobsApi } from '../lib/api';
import { sendDriverLocation, setDriverStatus } from '../lib/socket';
import { useSocket } from '../hooks/useSocket';

const RED   = '#E40521';
const DARK  = '#0A0A0A';
const CARD  = '#111111';
const BORD  = '#1F1F1F';
const TEXT  = '#F9FAFB';
const TEXT2 = '#9CA3AF';
const TEXT3 = '#4B5563';
const GREEN = '#22C55E';
const AMBER = '#F59E0B';
const BLUE  = '#3B82F6';

const TAG_COLORS = {
  pickup:   { bg: '#1A0505', color: '#FCA5A5', border: '#7F1D1D' },
  delivery: { bg: '#0A0D1A', color: '#93C5FD', border: '#1E3A8A' },
};

const STATUS_MAP = {
  booking_confirmed:  'Booking Confirmed',
  driver_assigned:    'Driver Assigned',
  vehicle_picked_up:  'Picked Up',
  inspection_done:    'Inspection Done',
  at_workshop:        'At Workshop',
  in_progress:        'In Progress',
  waiting_approval:   'Awaiting Approval',
  service_completed:  'Service Completed',
  ready_delivery:     'Ready for Delivery',
  out_delivery:       'Out for Delivery',
  delivered:          'Delivered',
};

const INSPECTION_CHECKLIST = [
  { id: 'ext_front',  label: 'Front Exterior',    group: 'exterior' },
  { id: 'ext_rear',   label: 'Rear Exterior',      group: 'exterior' },
  { id: 'ext_left',   label: 'Left Side',          group: 'exterior' },
  { id: 'ext_right',  label: 'Right Side',          group: 'exterior' },
  { id: 'interior',   label: 'Interior Condition', group: 'interior' },
  { id: 'windshield', label: 'Windshield',          group: 'mechanical' },
  { id: 'lights',     label: 'Lights Check',        group: 'mechanical' },
  { id: 'tires',      label: 'Tire Condition',      group: 'mechanical' },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function TopBar({ user, online, onToggle, logout }) {
  return (
    <div style={{ background: DARK, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${BORD}`, position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ background: RED, borderRadius: 6, padding: '3px 8px' }}>
          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: '#fff' }}>HONDA</span>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{user?.name}</div>
          <div style={{ fontSize: 10, color: TEXT3 }}>Driver App</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Online toggle */}
        <button onClick={onToggle} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
          background: online ? '#052010' : '#1A0A0A', border: `1px solid ${online ? '#15803D' : '#7F1D1D'}`,
          borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: 700,
          color: online ? GREEN : '#EF4444',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? GREEN : '#EF4444', display: 'inline-block' }} />
          {online ? 'ONLINE' : 'OFFLINE'}
        </button>
        <button onClick={logout} style={{ background: 'transparent', border: 'none', color: TEXT3, cursor: 'pointer', fontSize: 12 }}>
          Exit
        </button>
      </div>
    </div>
  );
}

function StatRow({ tasks, completed }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, padding: '16px 16px 0' }}>
      {[
        ['Tasks Today', tasks.length,     BLUE],
        ['Active',      tasks.filter(t => !t.completed_at).length, AMBER],
        ['Done',        completed,         GREEN],
      ].map(([label, val, color]) => (
        <div key={label} style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: TEXT3, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28, fontWeight: 700, color: TEXT, lineHeight: 1 }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function TaskCard({ task, onStart, onComplete }) {
  const [expanded, setExpanded] = useState(false);
  const tc = TAG_COLORS[task.task_type] || TAG_COLORS.pickup;
  const isDone = !!task.completed_at;

  return (
    <div style={{
      background: CARD, border: `1px solid ${isDone ? '#1A2A1A' : BORD}`,
      borderLeft: `4px solid ${task.task_type === 'pickup' ? RED : BLUE}`,
      borderRadius: 12, overflow: 'hidden', opacity: isDone ? 0.6 : 1,
    }}>
      <div onClick={() => setExpanded(!expanded)} style={{ padding: '16px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', padding: '3px 8px', borderRadius: 12, background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
              {task.task_type.toUpperCase()}
            </span>
            {isDone && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 12, background: '#052010', color: GREEN, border: `1px solid #15803D` }}>DONE</span>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 20, color: TEXT }}>
              {new Date(task.scheduled_at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ fontSize: 9, color: TEXT3 }}>SCHEDULED</div>
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: TEXT, marginBottom: 3 }}>{task.customer_name}</div>
        <div style={{ fontSize: 12, color: TEXT2, marginBottom: 6 }}>{task.model} · <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{task.plate}</span></div>
        <div style={{ fontSize: 12, color: TEXT3 }}>📍 {task.address}</div>
      </div>

      {expanded && !isDone && (
        <div style={{ borderTop: `1px solid ${BORD}`, padding: '14px 16px', background: '#0D0D0D' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <a href={`tel:${task.customer_phone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#0A1A0A', border: `1px solid #166534`, borderRadius: 8, fontSize: 13, fontWeight: 700, color: GREEN, textDecoration: 'none' }}>
              📞 Call
            </a>
            <a href={`https://maps.google.com/?q=${encodeURIComponent(task.address)}`} target="_blank" rel="noreferrer"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#0A0D1A', border: `1px solid #1E3A8A`, borderRadius: 8, fontSize: 13, fontWeight: 700, color: BLUE, textDecoration: 'none' }}>
              🗺️ Navigate
            </a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {!task.started_at ? (
              <button onClick={() => onStart(task)} style={{ gridColumn: '1/-1', padding: '12px', background: RED, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: "'Barlow',sans-serif" }}>
                Start Task
              </button>
            ) : (
              <button onClick={() => onComplete(task)} style={{ gridColumn: '1/-1', padding: '12px', background: GREEN, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: "'Barlow',sans-serif" }}>
                Mark Complete ✓
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InspectionModal({ jobId, onClose, onDone }) {
  const [items, setItems] = useState(INSPECTION_CHECKLIST.map(i => ({ ...i, done: false, note: '' })));
  const [fuel, setFuel]   = useState('');
  const [miles, setMiles] = useState('');
  const [extNote, setExtNote] = useState('');
  const [photos, setPhotos]   = useState([]);
  const [step, setStep]   = useState(0);  // 0=checklist 1=details 2=photos 3=sign
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  const doneCount  = items.filter(i => i.done).length;
  const STEPS = ['Checklist', 'Details', 'Photos', 'Signature'];

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setPhotos(prev => [...prev, ...files].slice(0, 8));
  };

  const submit = async () => {
    setLoading(true);
    try {
      await inspApi.upsert({
        job_id: jobId, fuel_level: fuel, mileage: parseInt(miles),
        exterior_note: extNote,
        windshield_ok: items.find(i => i.id === 'windshield')?.done,
        lights_ok:     items.find(i => i.id === 'lights')?.done,
      });

      if (photos.length) {
        const fd = new FormData();
        photos.forEach(f => fd.append('photos', f));
        await inspApi.photos(jobId, fd);
      }

      await inspApi.sign(jobId);
      onDone();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ background: DARK, flex: 1, maxWidth: 480, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BORD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: DARK, position: 'sticky', top: 0, zIndex: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: TEXT3, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Vehicle Inspection</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginTop: 2 }}>{STEPS[step]}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: TEXT3, cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', padding: '12px 20px', gap: 6 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? RED : BORD, transition: 'background 0.2s' }} />
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {step === 0 && (
            <div>
              <div style={{ fontSize: 12, color: TEXT2, marginBottom: 14 }}>{doneCount}/{items.length} items checked</div>
              {items.map((item, idx) => (
                <div key={item.id} onClick={() => setItems(prev => prev.map((it, i) => i === idx ? { ...it, done: !it.done } : it))}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: item.done ? '#0A1A0A' : CARD, borderRadius: 10, marginBottom: 8, border: `1px solid ${item.done ? '#166534' : BORD}`, cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${item.done ? GREEN : BORD}`, background: item.done ? GREEN : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {item.done ? '✓' : ''}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500, color: item.done ? TEXT : TEXT2 }}>{item.label}</span>
                </div>
              ))}
            </div>
          )}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Fuel Level', val: fuel, set: setFuel, ph: 'e.g. 3/4' },
                { label: 'Mileage (km)', val: miles, set: setMiles, ph: 'e.g. 45230', type: 'number' },
              ].map(f => (
                <div key={f.label}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: TEXT3, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>{f.label}</label>
                  <input type={f.type || 'text'} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                    style={{ width: '100%', padding: '12px 14px', background: CARD, border: `1px solid ${BORD}`, borderRadius: 8, fontSize: 15, color: TEXT, fontFamily: "'Barlow',sans-serif" }} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: TEXT3, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Exterior Notes</label>
                <textarea rows={4} value={extNote} onChange={e => setExtNote(e.target.value)} placeholder="Describe any existing damage..."
                  style={{ width: '100%', padding: '12px 14px', background: CARD, border: `1px solid ${BORD}`, borderRadius: 8, fontSize: 14, color: TEXT, fontFamily: "'Barlow',sans-serif", resize: 'vertical' }} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p style={{ fontSize: 13, color: TEXT2, marginBottom: 16 }}>Upload photos of the vehicle (up to 8). Tap to capture.</p>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" onChange={handleFileChange} style={{ display: 'none' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                {photos.map((f, i) => (
                  <div key={i} style={{ aspectRatio: '1', background: '#1A1A1A', borderRadius: 8, border: `1px solid ${BORD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    <img src={URL.createObjectURL(f)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
                {photos.length < 8 && (
                  <button onClick={() => fileRef.current.click()}
                    style={{ aspectRatio: '1', background: CARD, border: `2px dashed ${BORD}`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 4 }}>
                    <span style={{ fontSize: 24, color: TEXT3 }}>+</span>
                    <span style={{ fontSize: 10, color: TEXT3 }}>Photo</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p style={{ fontSize: 13, color: TEXT2, marginBottom: 20 }}>Ask the customer to review and confirm the inspection. By signing, they acknowledge the vehicle condition.</p>
              <div style={{ background: CARD, border: `2px dashed ${BORD}`, borderRadius: 12, padding: '60px 24px', textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✍️</div>
                <div style={{ fontSize: 14, color: TEXT2 }}>Customer signature area</div>
                <div style={{ fontSize: 12, color: TEXT3, marginTop: 4 }}>Tap "Confirm & Submit" to complete</div>
              </div>
              <div style={{ background: '#050D05', border: '1px solid #14532D', borderRadius: 10, padding: '12px 16px', fontSize: 12, color: '#86EFAC' }}>
                ✓ Inspection checklist: {doneCount}/{items.length} items completed<br />
                ✓ Fuel level: {fuel || 'not recorded'}<br />
                ✓ Mileage: {miles ? miles + ' km' : 'not recorded'}<br />
                ✓ Photos: {photos.length} uploaded
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${BORD}`, background: DARK, display: 'flex', gap: 10 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{ flex: '0 0 80px', padding: '13px', background: CARD, border: `1px solid ${BORD}`, borderRadius: 8, fontSize: 13, fontWeight: 700, color: TEXT2, cursor: 'pointer', fontFamily: "'Barlow',sans-serif" }}>
              Back
            </button>
          )}
          {step < 3 ? (
            <button onClick={() => setStep(s => s + 1)} style={{ flex: 1, padding: '13px', background: RED, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: "'Barlow',sans-serif" }}>
              Next →
            </button>
          ) : (
            <button onClick={submit} disabled={loading} style={{ flex: 1, padding: '13px', background: loading ? '#064E3B' : GREEN, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'Barlow',sans-serif" }}>
              {loading ? 'Submitting...' : 'Confirm & Submit ✓'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Driver App ───────────────────────────────────────────────────────────
export default function DriverApp() {
  const { user, logout }         = useAuth();
  const [tasks, setTasks]        = useState([]);
  const [loading, setLoading]    = useState(true);
  const [online, setOnline]      = useState(true);
  const [tab, setTab]            = useState('tasks');  // tasks | history | profile
  const [inspection, setInspection] = useState(null); // { jobId }
  const locationInterval         = useRef(null);

  // Load tasks
  const loadTasks = useCallback(async () => {
    try {
      const data = await driversApi.tasks('me');
      setTasks(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTasks(); }, []);

  // GPS broadcast every 30s when online
  useEffect(() => {
    if (!online) { clearInterval(locationInterval.current); return; }
    const broadcast = () => {
      navigator.geolocation?.getCurrentPosition(pos => {
        const activeTask = tasks.find(t => t.started_at && !t.completed_at);
        if (activeTask) sendDriverLocation(activeTask.job_id, pos.coords.latitude, pos.coords.longitude);
      });
    };
    broadcast();
    locationInterval.current = setInterval(broadcast, 30000);
    return () => clearInterval(locationInterval.current);
  }, [online, tasks]);

  // Real-time: coordinator assigns new task
  useSocket({ 'task:new': () => loadTasks() });

  const toggleOnline = () => {
    const next = !online;
    setOnline(next);
    setDriverStatus(next ? 'online' : 'offline');
  };

  const handleStartTask = async (task) => {
    try {
      await jobsApi.updateStatus(task.job_id, { status: 'vehicle_picked_up', note: 'Driver started pickup' });
      loadTasks();
    } catch (err) { alert(err.message); }
  };

  const handleCompleteTask = async (task) => {
    if (task.task_type === 'pickup') {
      setInspection({ jobId: task.job_id });
    } else {
      try {
        await jobsApi.updateStatus(task.job_id, { status: 'delivered', note: 'Vehicle delivered to customer' });
        loadTasks();
      } catch (err) { alert(err.message); }
    }
  };

  const activeTasks    = tasks.filter(t => !t.completed_at);
  const completedTasks = tasks.filter(t =>  t.completed_at);

  return (
    <div style={{ background: DARK, minHeight: '100vh', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', fontFamily: "'Barlow',sans-serif" }}>
      <TopBar user={user} online={online} onToggle={toggleOnline} logout={logout} />

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORD}`, background: '#0D0D0D', position: 'sticky', top: 61, zIndex: 40 }}>
        {[['tasks','Tasks'],['history','Done'],['profile','Profile']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: '12px 0', background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, color: tab === k ? RED : TEXT3,
            borderBottom: tab === k ? `2px solid ${RED}` : '2px solid transparent',
          }}>{l} {k === 'tasks' && activeTasks.length > 0 && <span style={{ background: RED, color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 10, marginLeft: 4 }}>{activeTasks.length}</span>}</button>
        ))}
      </div>

      {tab === 'tasks' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <StatRow tasks={tasks} completed={completedTasks.length} />
          <div style={{ padding: '16px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: TEXT3 }}>Loading tasks...</div>
            ) : activeTasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 6 }}>All clear!</div>
                <div style={{ fontSize: 13, color: TEXT3 }}>No pending tasks right now</div>
              </div>
            ) : (
              activeTasks.map(task => (
                <div key={task.id} style={{ marginBottom: 12 }}>
                  <TaskCard task={task} onStart={handleStartTask} onComplete={handleCompleteTask} />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {completedTasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: TEXT3 }}>No completed tasks today</div>
          ) : completedTasks.map(task => (
            <div key={task.id} style={{ marginBottom: 12, opacity: 0.7 }}>
              <TaskCard task={task} onStart={() => {}} onComplete={() => {}} />
            </div>
          ))}
        </div>
      )}

      {tab === 'profile' && (
        <div style={{ flex: 1, padding: 16 }}>
          <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 12, padding: '20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff' }}>
                {user?.name?.[0]}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{user?.name}</div>
                <div style={{ fontSize: 12, color: TEXT3 }}>Driver · {user?.phone}</div>
              </div>
            </div>
            {[
              ['Status', online ? '🟢 Online' : '🔴 Offline'],
              ['Tasks Today', tasks.length],
              ['Completed', completedTasks.length],
            ].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: `1px solid ${BORD}`, fontSize: 13 }}>
                <span style={{ color: TEXT3 }}>{l}</span>
                <span style={{ color: TEXT, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
          <button onClick={logout} style={{ width: '100%', padding: '13px', background: '#1A0505', border: `1px solid #7F1D1D`, borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#EF4444', cursor: 'pointer', fontFamily: "'Barlow',sans-serif" }}>
            Sign Out
          </button>
        </div>
      )}

      {inspection && (
        <InspectionModal
          jobId={inspection.jobId}
          onClose={() => setInspection(null)}
          onDone={() => { setInspection(null); loadTasks(); }}
        />
      )}
    </div>
  );
}
