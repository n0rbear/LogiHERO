const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { IS_DEPLOYED } = require('../config/env');

const devSeedRoutes = express.Router();

const blockDeployedDevDataChange = (req, res, next) => {
    if (IS_DEPLOYED) {
        return res.status(403).json({ error: 'Development seed endpoints are disabled in deployed environments.' });
    }
    return next();
};

devSeedRoutes.post('/admin/dev-seed-demo', requireAdmin, blockDeployedDevDataChange, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const now = Date.now();
        const companies = [
            { name: 'Demo Logistics GmbH', slug: 'demo-logistics' },
            { name: 'Cargo Pilot Kft.', slug: 'cargo-pilot' }
        ];
        const result = { companies: [], users: [], drivers: [], tours: [] };

        for (const company of companies) {
            const companyRow = (await client.query(
                `INSERT INTO companies (name, slug, is_demo)
                 VALUES ($1, $2, true)
                 ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                 RETURNING uuid, name, slug`,
                [company.name, company.slug]
            )).rows[0];
            result.companies.push(companyRow);

            const permissions = [
                ['CEO', 'tours', true, true],
                ['CEO', 'live_status', true, false],
                ['CEO', 'fuel', true, false],
                ['CEO', 'costs', true, true],
                ['CEO', 'chat', false, false],
                ['CEO', 'reports', true, false],
                ['DISPATCHER', 'tours', true, true],
                ['DISPATCHER', 'live_status', true, false],
                ['DISPATCHER', 'fuel', false, false],
                ['DISPATCHER', 'costs', false, false],
                ['DISPATCHER', 'chat', true, true],
                ['DISPATCHER', 'reports', true, false]
            ];
            for (const [role, module, canView, canEdit] of permissions) {
                await client.query(`INSERT INTO role_permissions (company_uuid, role, module, can_view, can_edit)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (company_uuid, role, module) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
                    [companyRow.uuid, role, module, canView, canEdit]);
            }

            const users = [
                { name: `${company.name} CEO`, email: `ceo@${company.slug}.test`, role: 'CEO' },
                { name: `${company.name} Dispatcher`, email: `dispatch@${company.slug}.test`, role: 'DISPATCHER' }
            ];
            for (const user of users) {
                const userRow = (await client.query(`INSERT INTO web_users (company_uuid, name, email, role, is_active)
                    VALUES ($1, $2, $3, $4, true)
                    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, company_uuid = EXCLUDED.company_uuid
                    RETURNING uuid, name, email, role`,
                    [companyRow.uuid, user.name, user.email, user.role])).rows[0];
                result.users.push(userRow);
            }

            const drivers = [
                { name: `${company.slug}-driver-1`, email: `driver1@${company.slug}.test`, plate: 'DEMO-101', code: `${company.slug.slice(0, 3).toUpperCase()}101` },
                { name: `${company.slug}-driver-2`, email: `driver2@${company.slug}.test`, plate: 'DEMO-202', code: `${company.slug.slice(0, 3).toUpperCase()}202` }
            ];
            for (const driver of drivers) {
                const driverRow = (await client.query(`INSERT INTO drivers (company_uuid, name, email, phone, license_plate, is_active, activation_code)
                    VALUES ($1, $2, $3, '+490000000', $4, true, $5)
                    ON CONFLICT (name) DO UPDATE SET company_uuid = EXCLUDED.company_uuid, email = EXCLUDED.email, license_plate = EXCLUDED.license_plate, activation_code = EXCLUDED.activation_code
                    RETURNING uuid, name, license_plate`,
                    [companyRow.uuid, driver.name, driver.email, driver.plate, driver.code])).rows[0];
                result.drivers.push(driverRow);

                const tourRow = (await client.query(`INSERT INTO tours (company_uuid, driver_uuid, driver_name, name, customer, date, notes, is_closed, is_current, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, 'Demo tour', false, true, $7)
                    RETURNING id, uuid, name`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, `Demo Tour ${driverRow.name}`, company.name, now, now])).rows[0];
                result.tours.push(tourRow);

                await client.query(`INSERT INTO stops (company_uuid, driver_uuid, tour_id, address, recipient, street, house_number, postal_code, city, address_full, contact_name, phone_number, email, time_window, notes, order_index, latitude, longitude, is_completed, stop_type, updated_at)
                    VALUES ($1, $2, $3, 'Arthur-Junghans-Str 1, 78713 Schramberg', 'Demo Recipient', 'Arthur-Junghans-Str', '1', '78713', 'Schramberg', 'Arthur-Junghans-Str 1, 78713 Schramberg', '', '', '', '08:00-12:00', '', 0, 48.2238915, 8.384806, false, 'DELIVERY', $4)`,
                    [companyRow.uuid, driverRow.uuid, tourRow.id, now]);

                await client.query(`INSERT INTO costs (company_uuid, driver_uuid, driver_name, amount, currency, category, notes, mileage, status, timestamp)
                    VALUES ($1, $2, $3, 75.50, 'EUR', 'Tankolas', 'Demo fuel receipt', 12345, 'Bekuldve', $4)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, now]);

                await client.query(`INSERT INTO chat_messages (company_uuid, driver_uuid, driver_name, sender, message, timestamp)
                    VALUES ($1, $2, $3, 'DISPATCHER', 'Demo uzenet a sofornek.', $4)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, now]);

                await client.query(`INSERT INTO live_updates (company_uuid, driver_uuid, driver_name, license_plate, latitude, longitude, speed, status, current_tour, timestamp)
                    VALUES ($1, $2, $3, $4, 48.2280912, 8.3869585, 0, 'Offline', $5, $6)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, driverRow.license_plate, tourRow.name, now]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, ...result });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

devSeedRoutes.post('/admin/dev-mint-tour', requireAdmin, blockDeployedDevDataChange, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const now = Date.now();
        const companySlug = 'logihero-mint';

        const companyRow = (await client.query(
            `INSERT INTO companies (name, slug, is_demo)
             VALUES ('LogiHERO Mint', $1, true)
             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
             RETURNING uuid`, [companySlug])).rows[0];

        const driverName = 'Mint Driver';
        const driverRow = (await client.query(
            `INSERT INTO drivers (company_uuid, name, email, phone, license_plate, is_active, activation_code)
             VALUES ($1, $2, 'mint@logihero.test', '+36201234567', 'MINT-001', true, 'MINT001')
             ON CONFLICT (name) DO UPDATE SET company_uuid = EXCLUDED.company_uuid, license_plate = EXCLUDED.license_plate
             RETURNING uuid`, [companyRow.uuid, driverName])).rows[0];

        const tourRow = (await client.query(
            `INSERT INTO tours (company_uuid, driver_uuid, driver_name, name, customer, date, notes, is_closed, is_current, updated_at,
                               depot_name, depot_lat, depot_lng, return_depot_name, return_depot_lat, return_depot_lng)
             VALUES ($1, $2, $3, 'Sprint 1.1 Mint Tour', 'LogiHERO Demo', $4, 'Stabilization test tour', false, true, $4,
                     'Budapest Depot', 47.4816, 19.1128, 'Budapest Depot', 47.4816, 19.1128)
             RETURNING id, uuid`, [companyRow.uuid, driverRow.uuid, driverName, now])).rows[0];

        const stops = [
            { recipient: 'Váci út Office', address: 'Budapest, Váci út 178', lat: 47.5528, lng: 19.0768, order: 0, status: 'COMPLETED', done: true },
            { recipient: 'Bazilika Checkpoint', address: 'Budapest, Szent István tér 1', lat: 47.5008, lng: 19.0539, order: 1, status: 'PENDING', done: false },
            { recipient: 'Allee Mall', address: 'Budapest, Október huszonharmadika u. 8-10', lat: 47.4768, lng: 19.0485, order: 2, status: 'PENDING', done: false },
            { recipient: 'Corvin Plaza', address: 'Budapest, Üllői út 26', lat: 47.4858, lng: 19.0705, order: 3, status: 'PENDING', done: false },
            { recipient: 'Invalid Stop', address: 'Nowhere', lat: 0, lng: 0, order: 4, status: 'PENDING', done: false }
        ];

        for (const s of stops) {
            await client.query(
                `INSERT INTO stops (company_uuid, driver_uuid, tour_id, recipient, address_full, order_index, latitude, longitude, is_completed, stop_status, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [companyRow.uuid, driverRow.uuid, tourRow.id, s.recipient, s.address, s.order, s.lat, s.lng, s.done, s.status, now]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, tourUuid: tourRow.uuid, driverName });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

module.exports = devSeedRoutes;

