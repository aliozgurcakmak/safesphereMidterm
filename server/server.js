const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const { query } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from /public
app.use(express.static(path.join(__dirname, '../public')));

const HASH_PREFIX = 'pbkdf2_sha256';
const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = 'sha256';

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST).toString('hex');
    return `${HASH_PREFIX}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword) return false;
    if (!storedPassword.startsWith(`${HASH_PREFIX}$`)) {
        return password === storedPassword;
    }

    const parts = storedPassword.split('$');
    if (parts.length !== 4) return false;

    const [, iterations, salt, storedHash] = parts;
    const candidate = crypto.pbkdf2Sync(password, salt, Number(iterations), HASH_KEY_LENGTH, HASH_DIGEST).toString('hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');
    const candidateBuffer = Buffer.from(candidate, 'hex');
    return storedBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(storedBuffer, candidateBuffer);
}

function roleKey(roleId, roleName = '') {
    const normalized = String(roleName).toLowerCase();
    if (normalized.includes('admin') || normalized.includes('administrator') || normalized.includes('yonetici') || normalized.includes('yönetici')) return 'admin';
    if (normalized.includes('emergency') || normalized.includes('acil')) return 'emergency';
    if (normalized.includes('rescue') || normalized.includes('kurtarma')) return 'rescue';
    if (normalized.includes('ngo') || normalized.includes('coordinator') || normalized.includes('koordinator') || normalized.includes('koordinat') || normalized.includes('stk')) return 'ngo';
    if (normalized.includes('public') || normalized.includes('user') || normalized.includes('kullanici') || normalized.includes('kullanıcı')) return 'public';

    const fallback = {
        1: 'admin',
        2: 'emergency',
        3: 'rescue',
        4: 'ngo',
        5: 'public'
    };
    return fallback[Number(roleId)] || 'public';
}

function strictRoleKeyFromName(roleName = '') {
    const normalized = String(roleName).toLowerCase();
    if (normalized.includes('admin') || normalized.includes('administrator') || normalized.includes('yonetici')) return 'admin';
    if (normalized.includes('emergency') || normalized.includes('acil')) return 'emergency';
    if (normalized.includes('rescue') || normalized.includes('kurtarma')) return 'rescue';
    if (normalized.includes('ngo') || normalized.includes('coordinator') || normalized.includes('koordinator') || normalized.includes('koordinat') || normalized.includes('stk')) return 'ngo';
    if (normalized.includes('public') || normalized.includes('user') || normalized.includes('kullan')) return 'public';
    return '';
}

function normalizeRequestedRoleKey(roleKeyValue, roleLabel) {
    const key = String(roleKeyValue || '').toLowerCase();
    if (['admin', 'emergency', 'rescue', 'ngo', 'public'].includes(key)) return key;
    return strictRoleKeyFromName(roleLabel);
}

async function getRolesWithKeys() {
    const result = await query(`
        SELECT role_id, role_name
        FROM Roles
        ORDER BY role_id
    `);
    return result.recordset.map(role => ({
        ...role,
        role_key: roleKey(role.role_id, role.role_name)
    }));
}

function canWrite(role, area) {
    if (role === 'admin') return true;
    if (role === 'emergency') return area === 'emergency';
    if (role === 'rescue') return area === 'rescue';
    if (role === 'ngo') return area === 'logistics';
    return false;
}

function allowedTcForRole(role) {
    return {
        admin: '11111111111',
        emergency: '22222222222',
        rescue: '33333333333',
        ngo: '44444444444'
    }[role] || null;
}

function canRegisterWithTc(role, tcNumber) {
    const allowedTc = allowedTcForRole(role);
    return !allowedTc || tcNumber === allowedTc;
}

function privilegedRoleKeyFromTc(tcNumber) {
    return {
        '11111111111': 'admin',
        '22222222222': 'emergency',
        '33333333333': 'rescue',
        '44444444444': 'ngo'
    }[String(tcNumber)] || '';
}

function conventionalRoleIdForKey(role) {
    return {
        admin: 1,
        emergency: 2,
        rescue: 3,
        ngo: 4,
        public: 5
    }[role];
}

function requirePermission(area) {
    return (req, res, next) => {
        const role = req.header('x-role-key') || roleKey(req.header('x-role-id'), req.header('x-role-name'));
        if (!canWrite(role, area)) {
            return res.status(403).json({ error: "You do not have permission for this action" });
        }
        next();
    };
}

async function ensureAuthSchema() {
    try {
        const phoneColumn = await query(`
            SELECT 1
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = 'phone'
        `);
        if (phoneColumn.recordset.length === 0) {
            await query(`ALTER TABLE Users ADD phone NVARCHAR(30) NULL`);
        }

        const passwordColumn = await query(`
            SELECT CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = 'password'
        `);
        const maxLength = passwordColumn.recordset[0]?.CHARACTER_MAXIMUM_LENGTH;
        if (maxLength !== -1 && (!maxLength || maxLength < 255)) {
            await query(`ALTER TABLE Users ALTER COLUMN password NVARCHAR(255) NOT NULL`);
        }

        const usersWithPlaintextPasswords = await query(`
            SELECT user_id, password
            FROM Users
            WHERE password IS NOT NULL
              AND password NOT LIKE '${HASH_PREFIX}$%'
        `);

        for (const user of usersWithPlaintextPasswords.recordset) {
            await query(`UPDATE Users SET password = @password WHERE user_id = @user_id`, {
                user_id: user.user_id,
                password: hashPassword(user.password)
            });
        }
    } catch (error) {
        console.warn("Auth schema check skipped:", error.message);
    }
}

// --- API ENDPOINTS ---

app.get('/api/health', async (req, res) => {
    try {
        await query('SELECT 1 AS connected');
        res.json({
            status: "online",
            database: process.env.DB_DATABASE || "SafeSphereDB",
            server: process.env.DB_SERVER || ".\\\\SQLEXPRESS"
        });
    } catch (error) {
        res.status(500).json({ error: "Database connection unavailable. Check SQL Server Express connection." });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { login, password } = req.body;

    if (!login || !password) {
        return res.status(400).json({ error: "Email/name and password are required" });
    }

    try {
        const result = await query(`
            SELECT TOP 1 u.user_id, u.role_id, u.full_name, u.email, u.phone, u.is_active, u.password, r.role_name
            FROM Users u
            LEFT JOIN Roles r ON u.role_id = r.role_id
            WHERE (LOWER(u.email) = LOWER(@login) OR LOWER(u.full_name) = LOWER(@login))
              AND ISNULL(u.is_active, 1) = 1
        `, { login: login.trim(), password });

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const user = result.recordset[0];
        if (!verifyPassword(password, user.password)) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (!user.password.startsWith(`${HASH_PREFIX}$`)) {
            await query(`UPDATE Users SET password = @password WHERE user_id = @user_id`, {
                user_id: user.user_id,
                password: hashPassword(password)
            });
        }

        delete user.password;
        user.role_key = roleKey(user.role_id, user.role_name);
        res.json({ user });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Login failed" });
    }
});

app.post('/api/auth/register', async (req, res) => {
    const { full_name, email, password, phone, role_id, role_key, role_label, tc_number } = req.body;

    if (!full_name || !email || !password || (!role_id && !role_key) || !tc_number) {
        return res.status(400).json({ error: "Full name, email, password, TC number and role are required" });
    }

    if (!/^\d{11}$/.test(String(tc_number))) {
        return res.status(400).json({ error: "TC number must be 11 digits" });
    }

    try {
        const roles = await getRolesWithKeys();
        const requestedRoleKey =
            privilegedRoleKeyFromTc(tc_number) ||
            strictRoleKeyFromName(role_label) ||
            normalizeRequestedRoleKey(role_key, role_label) ||
            strictRoleKeyFromName(roles.find(role => String(role.role_id) === String(role_id))?.role_name) ||
            'public';
        const selectedRole =
            roles.find(role => strictRoleKeyFromName(role.role_name) === requestedRoleKey) ||
            roles.find(role => role.role_key === requestedRoleKey) ||
            roles.find(role => Number(role.role_id) === conventionalRoleIdForKey(requestedRoleKey));

        if (!selectedRole) {
            return res.status(400).json({ error: "Selected role is invalid" });
        }

        const selectedRoleKey = selectedRole.role_key;
        if (!canRegisterWithTc(selectedRoleKey, String(tc_number))) {
            return res.status(403).json({ error: "Bu rol için izinli değilsiniz" });
        }

        const existing = await query(`
            SELECT TOP 1 user_id
            FROM Users
            WHERE LOWER(email) = LOWER(@email)
        `, { email: email.trim() });

        if (existing.recordset.length > 0) {
            return res.status(409).json({ error: "Email already registered" });
        }

        const result = await query(`
            INSERT INTO Users (role_id, full_name, email, password, phone, is_active)
            OUTPUT INSERTED.user_id, INSERTED.role_id, INSERTED.full_name, INSERTED.email, INSERTED.phone, INSERTED.is_active
            VALUES (@role_id, @full_name, @email, @password, @phone, 1)
        `, {
            role_id: selectedRole.role_id,
            full_name: full_name.trim(),
            email: email.trim(),
            password: hashPassword(password),
            phone: phone ? phone.trim() : null
        });

        const user = result.recordset[0];
        user.role_name = selectedRole.role_name;
        user.role_key = selectedRoleKey;
        res.status(201).json({ user });
    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ error: "Registration failed" });
    }
});

app.get('/api/roles', async (req, res) => {
    try {
        res.json(await getRolesWithKeys());
    } catch (error) {
        console.error("Roles error:", error);
        res.status(500).json({ error: "Failed to fetch roles" });
    }
});

app.get('/api/disasters', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            d.disaster_id, 
            d.disaster_title, 
            d.description, 
            d.start_date, 
            d.status, 
            d.disaster_type_id,
            d.severity_id,
            d.province_id,
            dt.disaster_type_name, 
            s.severity_name, 
            s.severity_score, 
            p.province_name, 
            dis.district_name, 
            dl.latitude, 
            dl.longitude, 
            dl.address_text 
            FROM Disasters d 
            JOIN DisasterTypes dt ON d.disaster_type_id = dt.disaster_type_id 
            JOIN DisasterSeverityLevels s ON d.severity_id = s.severity_id 
            JOIN Provinces p ON d.province_id = p.province_id 
            LEFT JOIN Districts dis ON d.district_id = dis.district_id 
            LEFT JOIN DisasterLocations dl ON d.disaster_id = dl.disaster_id 
            ORDER BY d.start_date DESC;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch disasters" });
    }
});

app.post('/api/disasters', requirePermission('emergency'), async (req, res) => {
    const { disaster_title, description, status, disaster_type_id, severity_id, province_id, district_id, latitude, longitude } = req.body;
    try {
        const queryWithTime = `
            INSERT INTO Disasters (disaster_title, description, start_date, status, disaster_type_id, severity_id, province_id, district_id)
            OUTPUT INSERTED.disaster_id
            VALUES (@disaster_title, @description, GETDATE(), @status, @disaster_type_id, @severity_id, @province_id, @district_id);
        `;
        const result = await query(queryWithTime, {
            disaster_title, description, status: status || 'Active',
            disaster_type_id: disaster_type_id || 1, severity_id: severity_id || 1,
            province_id: province_id || 1, district_id: district_id || null
        });
        
        const newDisasterId = result.recordset[0].disaster_id;
        
        if (latitude && longitude) {
            await query(`INSERT INTO DisasterLocations (disaster_id, latitude, longitude) VALUES (@id, @lat, @lng)`, {
                id: newDisasterId, lat: latitude, lng: longitude
            });
        }
        res.status(201).json({ message: "Disaster created" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create disaster" });
    }
});

app.put('/api/disasters/:id', requirePermission('emergency'), async (req, res) => {
    const { id } = req.params;
    const { disaster_title, description, status, disaster_type_id, severity_id, province_id } = req.body;
    try {
        await query(`
            UPDATE Disasters 
            SET disaster_title = ISNULL(@disaster_title, disaster_title),
                description = ISNULL(@description, description),
                status = ISNULL(@status, status),
                disaster_type_id = ISNULL(@disaster_type_id, disaster_type_id),
                severity_id = ISNULL(@severity_id, severity_id),
                province_id = ISNULL(@province_id, province_id)
            WHERE disaster_id = @id
        `, { id, disaster_title, description, status, disaster_type_id, severity_id, province_id });
        res.json({ message: "Disaster updated" });
    } catch (error) {
        res.status(500).json({ error: "Failed to update disaster" });
    }
});

app.delete('/api/disasters/:id', requirePermission('emergency'), async (req, res) => {
    const { id } = req.params;
    try {
        // Delete dependent records first
        await query(`DELETE FROM DisasterLocations WHERE disaster_id = @id`, { id });
        await query(`DELETE FROM DamageReports WHERE disaster_id = @id`, { id });
        await query(`DELETE FROM CasualtyReports WHERE disaster_id = @id`, { id });
        await query(`DELETE FROM Alerts WHERE disaster_id = @id`, { id });
        await query(`DELETE FROM RescueTasks WHERE disaster_id = @id`, { id });
        await query(`DELETE FROM ResourceAllocations WHERE disaster_id = @id`, { id });
        
        await query(`DELETE FROM Disasters WHERE disaster_id = @id`, { id });
        res.json({ message: "Disaster deleted" });
    } catch (error) {
        console.error("Delete disaster error:", error);
        res.status(500).json({ error: "Failed to delete disaster. It may have dependencies." });
    }
});


app.delete('/api/rescue-teams/:id', requirePermission('rescue'), async (req, res) => {
    const { id } = req.params;
    try { 
        // Delete dependent tasks and members
        await query(`DELETE FROM RescueTasks WHERE team_id = @id`, { id });
        await query(`DELETE FROM TeamMembers WHERE team_id = @id`, { id });
        
        await query(`DELETE FROM RescueTeams WHERE team_id = @id`, { id }); 
        res.json({message:"Deleted"}); 
    } catch(e) { 
        console.error("Delete team error:", e);
        res.status(500).json({error:"Error deleting team"}); 
    }
});
app.delete('/api/resource-allocations/:id', requirePermission('logistics'), async (req, res) => {
    try { await query(`DELETE FROM ResourceAllocations WHERE allocation_id = @id`, { id: req.params.id }); res.json({message:"Deleted"}); } catch(e) { res.status(500).json({error:"Error"}); }
});
app.delete('/api/damage-reports/:id', requirePermission('emergency'), async (req, res) => {
    try { await query(`DELETE FROM DamageReports WHERE damage_report_id = @id`, { id: req.params.id }); res.json({message:"Deleted"}); } catch(e) { res.status(500).json({error:"Error"}); }
});
app.delete('/api/casualty-reports/:id', requirePermission('emergency'), async (req, res) => {
    try { await query(`DELETE FROM CasualtyReports WHERE casualty_report_id = @id`, { id: req.params.id }); res.json({message:"Deleted"}); } catch(e) { res.status(500).json({error:"Error"}); }
});


app.post('/api/rescue-teams', requirePermission('rescue'), async (req, res) => {
    try {
        await query(`INSERT INTO RescueTeams (organization_id, team_name, team_status) VALUES (@org, @name, @status)`, 
        { org: req.body.organization_id, name: req.body.team_name, status: req.body.team_status });
        res.json({message:"Created"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});
app.put('/api/rescue-teams/:id', requirePermission('rescue'), async (req, res) => {
    try {
        await query(`UPDATE RescueTeams SET organization_id = ISNULL(@org, organization_id), team_name = ISNULL(@name, team_name), team_status = ISNULL(@status, team_status) WHERE team_id = @id`, 
        { id: req.params.id, org: req.body.organization_id, name: req.body.team_name, status: req.body.team_status });
        res.json({message:"Updated"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});

app.post('/api/resource-allocations', requirePermission('logistics'), async (req, res) => {
    try {
        await query(`INSERT INTO ResourceAllocations (disaster_id, resource_id, warehouse_id, allocated_quantity, allocated_by, allocation_date) 
        VALUES (@did, @rid, @wid, @qty, 1, GETDATE())`, 
        { did: req.body.disaster_id, rid: req.body.resource_id, wid: req.body.warehouse_id, qty: req.body.allocated_quantity });
        res.json({message:"Created"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});
app.put('/api/resource-allocations/:id', requirePermission('logistics'), async (req, res) => {
    try {
        await query(`UPDATE ResourceAllocations SET disaster_id = ISNULL(@did, disaster_id), resource_id = ISNULL(@rid, resource_id), warehouse_id = ISNULL(@wid, warehouse_id), allocated_quantity = ISNULL(@qty, allocated_quantity) WHERE allocation_id = @id`, 
        { id: req.params.id, did: req.body.disaster_id, rid: req.body.resource_id, wid: req.body.warehouse_id, qty: req.body.allocated_quantity });
        res.json({message:"Updated"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});

app.post('/api/damage-reports', requirePermission('emergency'), async (req, res) => {
    try {
        await query(`INSERT INTO DamageReports (disaster_id, reported_by, status_id, building_damage_level, infrastructure_damage_level, description, report_date) 
        VALUES (@did, 1, 1, @b, @i, @desc, GETDATE())`, 
        { did: req.body.disaster_id, b: req.body.building_damage_level, i: req.body.infrastructure_damage_level, desc: req.body.description });
        res.json({message:"Created"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});
app.put('/api/damage-reports/:id', requirePermission('emergency'), async (req, res) => {
    try {
        await query(`UPDATE DamageReports SET disaster_id = ISNULL(@did, disaster_id), building_damage_level = ISNULL(@b, building_damage_level), infrastructure_damage_level = ISNULL(@i, infrastructure_damage_level), description = ISNULL(@desc, description) WHERE damage_report_id = @id`, 
        { id: req.params.id, did: req.body.disaster_id, b: req.body.building_damage_level, i: req.body.infrastructure_damage_level, desc: req.body.description });
        res.json({message:"Updated"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});

app.post('/api/casualty-reports', requirePermission('emergency'), async (req, res) => {
    try {
        await query(`INSERT INTO CasualtyReports (disaster_id, reported_by, status_id, injured_count, missing_count, deceased_count, report_date) 
        VALUES (@did, 1, 1, @inj, @mis, @dec, GETDATE())`, 
        { did: req.body.disaster_id, inj: req.body.injured_count, mis: req.body.missing_count, dec: req.body.deceased_count });
        res.json({message:"Created"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});
app.put('/api/casualty-reports/:id', requirePermission('emergency'), async (req, res) => {
    try {
        await query(`UPDATE CasualtyReports SET disaster_id = ISNULL(@did, disaster_id), injured_count = ISNULL(@inj, injured_count), missing_count = ISNULL(@mis, missing_count), deceased_count = ISNULL(@dec, deceased_count) WHERE casualty_report_id = @id`, 
        { id: req.params.id, did: req.body.disaster_id, inj: req.body.injured_count, mis: req.body.missing_count, dec: req.body.deceased_count });
        res.json({message:"Updated"});
    } catch(e) { res.status(500).json({error:"Error"}); }
});

app.get('/api/alerts', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            a.alert_id, 
            a.alert_title, 
            a.alert_message, 
            a.alert_level, 
            a.created_at, 
            d.disaster_id, 
            d.disaster_title, 
            p.province_name, 
            u.full_name AS created_by_name 
            FROM Alerts a 
            JOIN Disasters d ON a.disaster_id = d.disaster_id 
            JOIN Provinces p ON d.province_id = p.province_id 
            JOIN Users u ON a.created_by = u.user_id 
            ORDER BY a.created_at DESC;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch alerts" });
    }
});

app.get('/api/rescue-teams', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            rt.team_id, 
            rt.team_name, 
            rt.team_status, 
            rt.organization_id,
            o.organization_name, 
            o.organization_type, 
            COUNT(tm.member_id) AS member_count 
            FROM RescueTeams rt 
            JOIN Organizations o ON rt.organization_id = o.organization_id 
            LEFT JOIN TeamMembers tm ON rt.team_id = tm.team_id 
            GROUP BY rt.team_id, rt.team_name, rt.team_status, rt.organization_id, o.organization_name, o.organization_type 
            ORDER BY rt.team_id;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch rescue teams" });
    }
});

app.get('/api/rescue-tasks', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            task.task_id, 
            task.task_title, 
            task.task_description, 
            task.task_status, 
            task.assigned_date, 
            d.disaster_id, 
            d.disaster_title, 
            task.team_id,
            rt.team_name, 
            u.full_name AS assigned_by_name 
            FROM RescueTasks task 
            JOIN Disasters d ON task.disaster_id = d.disaster_id 
            JOIN RescueTeams rt ON task.team_id = rt.team_id 
            JOIN Users u ON task.assigned_by = u.user_id 
            ORDER BY task.assigned_date DESC;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch rescue tasks" });
    }
});

app.post('/api/rescue-tasks', requirePermission('rescue'), async (req, res) => {
    const { disaster_id, team_id, task_title, task_description, task_status, assigned_by } = req.body;
    try {
        const sqlQuery = `
            INSERT INTO RescueTasks (disaster_id, team_id, task_title, task_description, task_status, assigned_by, assigned_date)
            VALUES (@disaster_id, @team_id, @task_title, @task_description, @task_status, @assigned_by, GETDATE());
        `;
        await query(sqlQuery, {
            disaster_id,
            team_id,
            task_title,
            task_description,
            task_status: task_status || 'Pending',
            assigned_by: assigned_by || 1 // default user for demo
        });
        res.status(201).json({ message: "Task created successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to create rescue task" });
    }
});

app.put('/api/rescue-tasks/:id', requirePermission('rescue'), async (req, res) => {
    const { id } = req.params;
    const { disaster_id, team_id, task_title, task_description, task_status } = req.body;
    try {
        const sqlQuery = `
            UPDATE RescueTasks 
            SET task_status = ISNULL(@task_status, task_status),
                disaster_id = ISNULL(@disaster_id, disaster_id),
                team_id = ISNULL(@team_id, team_id),
                task_title = ISNULL(@task_title, task_title),
                task_description = ISNULL(@task_description, task_description)
            WHERE task_id = @id;
        `;
        await query(sqlQuery, { id, task_status, disaster_id, team_id, task_title, task_description });
        res.json({ message: "Task updated successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to update rescue task" });
    }
});

app.delete('/api/rescue-tasks/:id', requirePermission('rescue'), async (req, res) => {
    const { id } = req.params;
    try {
        const sqlQuery = `
            DELETE FROM RescueTasks 
            WHERE task_id = @id;
        `;
        await query(sqlQuery, { id });
        res.json({ message: "Task deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete rescue task" });
    }
});

app.get('/api/resources', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            rs.stock_id, 
            r.resource_name, 
            r.unit, 
            rt.resource_type_name, 
            rs.quantity, 
            rw.warehouse_name, 
            p.province_name, 
            dis.district_name 
            FROM ResourceStock rs 
            JOIN Resources r ON rs.resource_id = r.resource_id 
            JOIN ResourceTypes rt ON r.resource_type_id = rt.resource_type_id 
            JOIN ResourceWarehouses rw ON rs.warehouse_id = rw.warehouse_id 
            JOIN Provinces p ON rw.province_id = p.province_id 
            LEFT JOIN Districts dis ON rw.district_id = dis.district_id 
            ORDER BY rw.warehouse_name;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch resources" });
    }
});

app.post('/api/resource-stock', requirePermission('logistics'), async (req, res) => {
    const { warehouse_id, resource_id, quantity } = req.body;
    try {
        await query(`
            INSERT INTO ResourceStock (warehouse_id, resource_id, quantity)
            VALUES (@warehouse_id, @resource_id, @quantity)
        `, { warehouse_id, resource_id, quantity });
        res.status(201).json({ message: "Resource stock added" });
    } catch (error) {
        res.status(500).json({ error: "Failed to add resource stock" });
    }
});

app.put('/api/resource-stock/:id', requirePermission('logistics'), async (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body;
    try {
        await query(`UPDATE ResourceStock SET quantity = @quantity WHERE stock_id = @id`, { id, quantity });
        res.json({ message: "Resource stock updated" });
    } catch (error) {
        res.status(500).json({ error: "Failed to update resource stock" });
    }
});

app.delete('/api/resource-stock/:id', requirePermission('logistics'), async (req, res) => {
    const { id } = req.params;
    try {
        await query(`DELETE FROM ResourceStock WHERE stock_id = @id`, { id });
        res.json({ message: "Resource stock deleted" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete resource stock" });
    }
});

app.get('/api/resource-allocations', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            ra.allocation_id, 
            d.disaster_id, 
            d.disaster_title, 
            ra.resource_id,
            r.resource_name, 
            r.unit, 
            ra.allocated_quantity, 
            ra.warehouse_id,
            rw.warehouse_name, 
            u.full_name AS allocated_by_name, 
            ra.allocation_date 
            FROM ResourceAllocations ra 
            JOIN Disasters d ON ra.disaster_id = d.disaster_id 
            JOIN Resources r ON ra.resource_id = r.resource_id 
            JOIN ResourceWarehouses rw ON ra.warehouse_id = rw.warehouse_id 
            JOIN Users u ON ra.allocated_by = u.user_id 
            ORDER BY ra.allocation_date DESC;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch resource allocations" });
    }
});

app.get('/api/damage-reports', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            dr.damage_report_id, 
            d.disaster_id, 
            d.disaster_title, 
            u.full_name AS reported_by_name, 
            rs.status_name, 
            dr.building_damage_level, 
            dr.infrastructure_damage_level, 
            dr.description, 
            dr.report_date 
            FROM DamageReports dr 
            JOIN Disasters d ON dr.disaster_id = d.disaster_id 
            JOIN Users u ON dr.reported_by = u.user_id 
            JOIN ReportStatuses rs ON dr.status_id = rs.status_id 
            ORDER BY dr.report_date DESC;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch damage reports" });
    }
});

app.get('/api/casualty-reports', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            cr.casualty_report_id, 
            d.disaster_id, 
            d.disaster_title, 
            u.full_name AS reported_by_name, 
            rs.status_name, 
            cr.injured_count, 
            cr.missing_count, 
            cr.deceased_count, 
            cr.report_date 
            FROM CasualtyReports cr 
            JOIN Disasters d ON cr.disaster_id = d.disaster_id 
            JOIN Users u ON cr.reported_by = u.user_id 
            JOIN ReportStatuses rs ON cr.status_id = rs.status_id 
            ORDER BY cr.report_date DESC;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch casualty reports" });
    }
});

app.get('/api/warehouses', async (req, res) => {
    try {
        const sqlQuery = `
            SELECT 
            rw.warehouse_id, 
            rw.warehouse_name, 
            rw.address_text, 
            p.province_name, 
            dis.district_name 
            FROM ResourceWarehouses rw 
            JOIN Provinces p ON rw.province_id = p.province_id 
            LEFT JOIN Districts dis ON rw.district_id = dis.district_id 
            ORDER BY rw.warehouse_id;
        `;
        const result = await query(sqlQuery);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch warehouses" });
    }
});

app.get('/api/dashboard-summary', async (req, res) => {
    try {
        const summary = {
            total_disasters: 0,
            active_disasters: 0,
            total_alerts: 0,
            total_rescue_teams: 0,
            total_resource_stock: 0,
            total_injured: 0,
            total_missing: 0,
            total_deceased: 0
        };

        const totalDisastersResult = await query('SELECT COUNT(*) AS count FROM Disasters');
        summary.total_disasters = totalDisastersResult.recordset[0].count;

        const activeDisastersResult = await query(`SELECT COUNT(*) AS count FROM Disasters WHERE status = 'Active'`);
        summary.active_disasters = activeDisastersResult.recordset[0].count;

        const totalAlertsResult = await query('SELECT COUNT(*) AS count FROM Alerts');
        summary.total_alerts = totalAlertsResult.recordset[0].count;

        const totalRescueTeamsResult = await query('SELECT COUNT(*) AS count FROM RescueTeams');
        summary.total_rescue_teams = totalRescueTeamsResult.recordset[0].count;

        const totalResourcesResult = await query('SELECT ISNULL(SUM(quantity), 0) AS count FROM ResourceStock');
        summary.total_resource_stock = totalResourcesResult.recordset[0].count;

        const casualtiesResult = await query(`
            SELECT 
            ISNULL(SUM(injured_count), 0) AS injured,
            ISNULL(SUM(missing_count), 0) AS missing,
            ISNULL(SUM(deceased_count), 0) AS deceased
            FROM CasualtyReports
        `);
        summary.total_injured = casualtiesResult.recordset[0].injured;
        summary.total_missing = casualtiesResult.recordset[0].missing;
        summary.total_deceased = casualtiesResult.recordset[0].deceased;

        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
});

app.get('/api/disaster-detail/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const disasterResult = await query(`
            SELECT 
            d.disaster_id, 
            d.disaster_title, 
            d.description, 
            d.start_date, 
            d.status, 
            dt.disaster_type_name, 
            s.severity_name, 
            s.severity_score, 
            p.province_name, 
            dis.district_name, 
            dl.latitude, 
            dl.longitude, 
            dl.address_text 
            FROM Disasters d 
            JOIN DisasterTypes dt ON d.disaster_type_id = dt.disaster_type_id 
            JOIN DisasterSeverityLevels s ON d.severity_id = s.severity_id 
            JOIN Provinces p ON d.province_id = p.province_id 
            LEFT JOIN Districts dis ON d.district_id = dis.district_id 
            LEFT JOIN DisasterLocations dl ON d.disaster_id = dl.disaster_id 
            WHERE d.disaster_id = @id
        `, { id });

        if (disasterResult.recordset.length === 0) {
            return res.status(404).json({ error: "Disaster not found" });
        }

        const disaster = disasterResult.recordset[0];

        const damageReportsResult = await query(`
            SELECT dr.*, u.full_name AS reported_by_name, rs.status_name 
            FROM DamageReports dr 
            JOIN Users u ON dr.reported_by = u.user_id 
            JOIN ReportStatuses rs ON dr.status_id = rs.status_id 
            WHERE dr.disaster_id = @id
        `, { id });

        const casualtyReportsResult = await query(`
            SELECT cr.*, u.full_name AS reported_by_name, rs.status_name 
            FROM CasualtyReports cr 
            JOIN Users u ON cr.reported_by = u.user_id 
            JOIN ReportStatuses rs ON cr.status_id = rs.status_id 
            WHERE cr.disaster_id = @id
        `, { id });

        const alertsResult = await query(`
            SELECT a.*, u.full_name AS created_by_name 
            FROM Alerts a 
            JOIN Users u ON a.created_by = u.user_id 
            WHERE a.disaster_id = @id
            ORDER BY a.created_at DESC
        `, { id });

        const rescueTasksResult = await query(`
            SELECT task.*, rt.team_name, u.full_name AS assigned_by_name 
            FROM RescueTasks task 
            JOIN RescueTeams rt ON task.team_id = rt.team_id 
            JOIN Users u ON task.assigned_by = u.user_id 
            WHERE task.disaster_id = @id
            ORDER BY task.assigned_date DESC
        `, { id });

        const resourceAllocationsResult = await query(`
            SELECT ra.*, r.resource_name, r.unit, rw.warehouse_name, u.full_name AS allocated_by_name 
            FROM ResourceAllocations ra 
            JOIN Resources r ON ra.resource_id = r.resource_id 
            JOIN ResourceWarehouses rw ON ra.warehouse_id = rw.warehouse_id 
            JOIN Users u ON ra.allocated_by = u.user_id 
            WHERE ra.disaster_id = @id
            ORDER BY ra.allocation_date DESC
        `, { id });

        // attachments
        const attachmentsResult = await query(`
            SELECT ra.* 
            FROM ReportAttachments ra
            LEFT JOIN DamageReports dr ON ra.damage_report_id = dr.damage_report_id
            LEFT JOIN CasualtyReports cr ON ra.casualty_report_id = cr.casualty_report_id
            WHERE dr.disaster_id = @id OR cr.disaster_id = @id
        `, { id });

        res.json({
            disaster: disaster,
            damageReports: damageReportsResult.recordset,
            casualtyReports: casualtyReportsResult.recordset,
            alerts: alertsResult.recordset,
            rescueTasks: rescueTasksResult.recordset,
            resourceAllocations: resourceAllocationsResult.recordset,
            attachments: attachmentsResult.recordset
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch disaster details" });
    }
});

app.get('/api/provinces', async (req, res) => {
    try {
        const result = await query('SELECT province_id, province_name FROM Provinces ORDER BY province_name');
        res.json(result.recordset);
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.get('/api/organizations', async (req, res) => {
    try {
        const result = await query('SELECT organization_id, organization_name FROM Organizations ORDER BY organization_name');
        res.json(result.recordset);
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.get('/api/base-resources', async (req, res) => {
    try {
        const result = await query('SELECT resource_id, resource_name FROM Resources ORDER BY resource_name');
        res.json(result.recordset);
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

// Fallback to index.html for single-page style routing if needed
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

ensureAuthSchema().finally(() => {
    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
});
