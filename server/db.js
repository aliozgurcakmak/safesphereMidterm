const sql = require("mssql/msnodesqlv8");
require("dotenv").config();

const config = {
    connectionString: `Driver={${process.env.DB_DRIVER || 'ODBC Driver 17 for SQL Server'}};Server=${process.env.DB_SERVER || '.\\SQLEXPRESS'};Database=${process.env.DB_DATABASE || 'SafeSphereDB'};Trusted_Connection=yes;TrustServerCertificate=yes;`
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('Connected to SQL Server Express via msnodesqlv8');
        return pool;
    })
    .catch(err => {
        console.error('Database Connection Failed! Bad Config: ', err);
        throw err;
    });

async function query(text, params) {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                request.input(key, value);
            }
        }
        const result = await request.query(text);
        return result;
    } catch (err) {
        console.error('SQL Error: ', err);
        throw err;
    }
}

module.exports = {
    sql,
    poolPromise,
    query
};
