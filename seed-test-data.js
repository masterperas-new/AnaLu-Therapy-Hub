const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data', 'app.db'));
db.pragma('journal_mode = WAL');

// Patients with valid Portuguese NIFs
const patients = [
  { name: 'Maria Silva',     notes: 'Anxiety disorder, weekly sessions', phone: '912345678', email: 'maria.silva@email.pt',    address: 'Rua Augusta 42, Lisboa',           nif: '123456789' },
  { name: 'João Santos',     notes: 'Post-surgery rehabilitation',       phone: '936789012', email: 'joao.santos@email.pt',    address: 'Av. da Liberdade 100, Lisboa',     nif: '272654308' },
  { name: 'Ana Costa',       notes: 'Chronic back pain',                 phone: '961234567', email: 'ana.costa@email.pt',      address: 'Rua de Santa Catarina 15, Porto',  nif: '507280790' },
  { name: 'Pedro Ferreira',  notes: 'Sports injury recovery',            phone: '918765432', email: 'pedro.f@email.pt',        address: 'Praça do Comércio 5, Lisboa',      nif: '244828040' },
  { name: 'Sofia Oliveira',  notes: 'Stress management, burnout',        phone: '934567890', email: 'sofia.oliveira@email.pt', address: 'Rua Garrett 28, Lisboa',           nif: '286982640' },
  { name: 'Ricardo Pereira', notes: 'Shoulder tendinitis',               phone: '965432109', email: 'ricardo.p@email.pt',      address: 'Av. dos Aliados 33, Porto',        nif: '504426290' },
  { name: 'Inês Rodrigues',  notes: 'Postpartum depression',             phone: '911223344', email: 'ines.r@email.pt',         address: 'Rua do Carmo 10, Coimbra',         nif: null },
  { name: 'Carlos Almeida',  notes: 'Knee replacement follow-up',        phone: '937788990', email: null,                      address: 'Largo do Chiado 7, Lisboa',        nif: '218462850' },
];

const insertClient = db.prepare('INSERT OR IGNORE INTO clients (full_name, condition_notes, phone, email, address, nif) VALUES (?, ?, ?, ?, ?, ?)');
const checkClient = db.prepare('SELECT id FROM clients WHERE full_name = ?');

const clientIds = [];
for (const p of patients) {
  let row = checkClient.get(p.name);
  if (row) {
    // Update NIF on existing patients
    db.prepare('UPDATE clients SET nif = ? WHERE id = ?').run(p.nif, row.id);
    clientIds.push({ id: row.id, name: p.name });
  } else {
    const r = insertClient.run(p.name, p.notes, p.phone, p.email, p.address, p.nif);
    clientIds.push({ id: Number(r.lastInsertRowid), name: p.name });
  }
}
console.log(`Patients: ${clientIds.length} ready`);

// Insurance data
const insurances = [
  { clientName: 'Maria Silva',     insurance: 'ADSE Familiar',     provider: 'ADSE',       policy: 'ADSE-2024-981234' },
  { clientName: 'João Santos',     insurance: 'Multicare',         provider: 'Fidelidade', policy: 'MC-PT-20250312' },
  { clientName: 'Ana Costa',       insurance: 'ADSE Individual',   provider: 'ADSE',       policy: 'ADSE-2025-554321' },
  { clientName: 'Ana Costa',       insurance: 'Médis Plus',        provider: 'Médis',      policy: 'MED-2025-887766' },
  { clientName: 'Pedro Ferreira',  insurance: 'AdvanceCare Sport', provider: 'AdvanceCare', policy: 'AC-SPT-20260101' },
  { clientName: 'Sofia Oliveira',  insurance: 'ADSE',              provider: 'ADSE',       policy: 'ADSE-2023-112233' },
  { clientName: 'Ricardo Pereira', insurance: 'Allianz Saúde',     provider: 'Allianz',    policy: 'ALZ-PT-99001122' },
  { clientName: 'Carlos Almeida',  insurance: 'Medicare Senior',   provider: 'Medicare',   policy: 'MRC-SN-20260415' },
];

const insertIns = db.prepare('INSERT INTO patient_insurances (client_id, insurance_name, policy_number, provider_name) VALUES (?, ?, ?, ?)');
const checkIns = db.prepare('SELECT id FROM patient_insurances WHERE client_id = ? AND insurance_name = ?');

let insCount = 0;
for (const ins of insurances) {
  const client = clientIds.find(c => c.name === ins.clientName);
  if (!client) continue;
  const existing = checkIns.get(client.id, ins.insurance);
  if (!existing) {
    insertIns.run(client.id, ins.insurance, ins.policy, ins.provider);
    insCount++;
  }
}
console.log(`Insurances: ${insCount} inserted`);

// Appointments
const insertAppointment = db.prepare(
  'INSERT INTO appointments (client_id, user_id, appointment_date, location, fee_cents, duration_minutes, notes, wire_received, wire_received_date, payment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const checkAppt = db.prepare('SELECT count(*) as cnt FROM appointments WHERE client_id = ?');

const locations = ['Consultório Lisboa', 'Clínica do Porto', 'Domicílio', 'Hospital Santa Maria'];
const payTypes = ['MBWay', 'Wire', 'Cash', 'Card'];

let apptCount = 0;
for (const client of clientIds) {
  const existing = checkAppt.get(client.id);
  if (existing.cnt > 0) continue;

  const numAppts = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < numAppts; i++) {
    const daysAgo = Math.floor(Math.random() * 90) - 10;
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const dateStr = d.toISOString();
    const loc = locations[Math.floor(Math.random() * locations.length)];
    const fee = [5000, 6000, 7500, 8000][Math.floor(Math.random() * 4)];
    const dur = [30, 45, 60, 90][Math.floor(Math.random() * 4)];
    const paid = daysAgo > 0 ? (Math.random() > 0.3 ? 1 : 0) : 0;
    const paidDate = paid ? d.toISOString().slice(0, 10) : null;
    const pType = paid ? payTypes[Math.floor(Math.random() * payTypes.length)] : null;

    insertAppointment.run(client.id, 1, dateStr, loc, fee, dur, null, paid, paidDate, pType);
    apptCount++;
  }
}
console.log(`Appointments: ${apptCount} inserted`);

db.close();
console.log('Done.');
