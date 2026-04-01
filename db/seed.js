require('dotenv').config();
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const hash = (pw) => bcrypt.hash(pw, 12);

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── Users ───────────────────────────────────────────────────────────────
    const adminHash = await hash('admin1234');
    const { rows: [admin] } = await client.query(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES ('System Admin', 'admin@honda-uae.com', '+97140000001', $1, 'admin')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `, [adminHash]);

    const coordHash = await hash('coord1234');
    const { rows: [coord] } = await client.query(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES ('Mohammed Al Zaabi', 'coordinator@honda-uae.com', '+97150000002', $1, 'coordinator')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `, [coordHash]);

    const driverHash = await hash('driver1234');
    const { rows: [driver] } = await client.query(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES ('Khalid Hassan', 'driver@honda-uae.com', '+97155000003', $1, 'driver')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `, [driverHash]);

    const custHash = await hash('customer1234');
    const { rows: [customer] } = await client.query(`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES ('Ahmed Al Mansouri', 'customer@example.com', '+97150123456', $1, 'customer')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `, [custHash]);

    // ─── Service Center ───────────────────────────────────────────────────────
    const { rows: [sc] } = await client.query(`
      INSERT INTO service_centers (name, address, city, phone, latitude, longitude)
      VALUES ('Honda Service Center – Al Quoz', 'Al Quoz Industrial Area 3, Dubai', 'Dubai', '+97143000000', 25.1350, 55.2250)
      ON CONFLICT DO NOTHING RETURNING id
    `);

    // ─── Vehicle ──────────────────────────────────────────────────────────────
    const { rows: [vehicle] } = await client.query(`
      INSERT INTO vehicles (customer_id, make, model, year, plate, color)
      VALUES ($1, 'Honda', 'CR-V', 2022, 'B 12345 DXB', 'Pearl White')
      ON CONFLICT (plate) DO UPDATE SET color = EXCLUDED.color RETURNING id
    `, [customer.id]);

    // ─── Job ──────────────────────────────────────────────────────────────────
    const { rows: [job] } = await client.query(`
      INSERT INTO jobs (customer_id, vehicle_id, coordinator_id, driver_id, service_center_id,
                        service_type, status, pickup_address, scheduled_pickup_at)
      VALUES ($1,$2,$3,$4,$5,'Major Service (60,000 km)','waiting_approval',
              'Villa 42, Al Barsha 1, Dubai', NOW() + INTERVAL '1 hour')
      RETURNING id
    `, [customer.id, vehicle.id, coord.id, driver.id, sc?.id]);

    // Status history
    const steps = ['booking_confirmed','driver_assigned','vehicle_picked_up','inspection_done','at_workshop','in_progress','waiting_approval'];
    for (let i = 0; i < steps.length; i++) {
      await client.query(
        `INSERT INTO job_status_history (job_id, status, changed_by, note) VALUES ($1,$2,$3,$4)`,
        [job.id, steps[i], coord.id, `Step ${i + 1} completed`]
      );
    }

    // Inspection
    const { rows: [insp] } = await client.query(`
      INSERT INTO inspections (job_id, driver_id, fuel_level, mileage, exterior_note, customer_signed, customer_signed_at)
      VALUES ($1,$2,'3/4',45230,'Minor scratch rear bumper (pre-existing)',TRUE,NOW())
      RETURNING id
    `, [job.id, driver.id]);

    // Quotation
    const { rows: [quot] } = await client.query(`
      INSERT INTO quotations (job_id, total_amount) VALUES ($1, 1450.00) RETURNING id
    `, [job.id]);

    const items = [
      ['Engine Oil Change (0W-20 Synthetic)', 280],
      ['Oil Filter Replacement', 45],
      ['Air Filter', 120],
      ['Cabin Filter', 95],
      ['Brake Fluid Flush', 180],
      ['Tire Rotation', 100],
      ['Labor', 450],
    ];
    for (let i = 0; i < items.length; i++) {
      await client.query(
        `INSERT INTO quotation_items (quotation_id, name, unit_price, sort_order) VALUES ($1,$2,$3,$4)`,
        [quot.id, items[i][0], items[i][1], i]
      );
    }

    await client.query('COMMIT');

    console.log('✅ Seed complete');
    console.log('\n📋 Test Credentials:');
    console.log('  Admin       → admin@honda-uae.com        / admin1234');
    console.log('  Coordinator → coordinator@honda-uae.com  / coord1234');
    console.log('  Driver      → driver@honda-uae.com       / driver1234');
    console.log('  Customer    → customer@example.com        / customer1234');
    console.log(`\n  Sample Job ID: ${job.id}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
};

seed();
