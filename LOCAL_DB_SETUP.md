# Local PostgreSQL Database Setup

This guide will help you set up a local PostgreSQL database for FinCal, allowing you to store transactions locally in addition to (or instead of) the cloud database.

## Prerequisites

- PostgreSQL installed on your system
- Node.js and npm installed
- Basic knowledge of command line

## Step 1: Install PostgreSQL

### macOS (using Homebrew)
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Important**: After installing PostgreSQL via Homebrew, you may need to add it to your PATH. The PATH has been automatically added to your `~/.zshrc`. Reload your shell:

```bash
source ~/.zshrc
```

Or use the full path directly:
```bash
/opt/homebrew/opt/postgresql@16/bin/psql postgres
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Windows
Download and install from [PostgreSQL official website](https://www.postgresql.org/download/windows/)

## Step 2: Create Database and User

1. Open a terminal and connect to PostgreSQL:

**macOS (if PATH is set):**
```bash
psql postgres
```

**macOS (using full path):**
```bash
/opt/homebrew/opt/postgresql@16/bin/psql postgres
```

**Linux:**
```bash
sudo -u postgres psql
```

**Windows:**
```bash
psql -U postgres
```

2. Create a new database:
```sql
CREATE DATABASE fincal;
```

3. Create a user (optional, you can use the default postgres user):
```sql
CREATE USER fincal_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE fincal TO fincal_user;
```

4. Exit psql:
```sql
\q
```

## Step 3: Configure Environment Variables

1. Create or edit the `.env` file in your project root:
```bash
# Cloud database (required)
DATABASE_URL=postgresql://user:password@your-cloud-db-host:5432/dbname

# Local database (optional, for CSV upload to local DB)
LOCAL_DATABASE_URL=postgresql://fincal_user:your_secure_password@localhost:5432/fincal
```

**Note**: Replace `fincal_user`, `your_secure_password`, and `fincal` with your actual values.

## Step 4: Run Database Migrations

1. **Set LOCAL_DATABASE_URL in your `.env` file** (recommended):
```bash
# Add to your .env file
LOCAL_DATABASE_URL=postgresql://fincal_user:your_secure_password@localhost:5432/fincal
```

2. **Push the schema to your local database**:
```bash
npm run db:push
```

The `drizzle.config.ts` will automatically use `LOCAL_DATABASE_URL` if it's set, otherwise it will use `DATABASE_URL`.

**Note**: Make sure `LOCAL_DATABASE_URL` is set in your `.env` file before running `npm run db:push`, or the schema will be pushed to your cloud database instead.

## Step 5: Verify Setup

1. Test the connection:
```bash
psql -U fincal_user -d fincal -h localhost
```

2. Check if tables were created:
```sql
\dt
```

You should see tables like `users`, `accounts`, `transactions`, `categories`, etc.

## Step 6: Using Local Database with CSV Upload

1. Start your development server:
```bash
npm run dev
```

2. Navigate to the Accounts page
3. Click "Upload CSV"
4. Select your CSV file
5. **Choose your upload destination:**
   - **Cloud Database Only**: Save to cloud database (Neon, Supabase, etc.)
   - **Local Database Only**: Save to local PostgreSQL database
   - **Both Databases**: Save to both cloud and local databases
6. Click "Import"

Transactions will be saved to the selected destination(s).

## Troubleshooting

### Connection Refused
- Ensure PostgreSQL is running: `brew services list` (macOS) or `sudo systemctl status postgresql` (Linux)
- Check if PostgreSQL is listening on the correct port (default: 5432)

### Authentication Failed
- Verify username and password in `LOCAL_DATABASE_URL`
- Check PostgreSQL authentication settings in `pg_hba.conf`

### Database Does Not Exist
- Run the CREATE DATABASE command from Step 2
- Verify the database name in `LOCAL_DATABASE_URL`

### Permission Denied (Error: permission denied for schema public)
This is the most common issue. Fix it by running these SQL commands as the `postgres` superuser:

```bash
# Connect as postgres superuser
psql -U postgres -d fincal

# Then run these commands:
GRANT ALL ON SCHEMA public TO fincal_user;
GRANT ALL PRIVILEGES ON DATABASE fincal TO fincal_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO fincal_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO fincal_user;
```

**Alternative (if you can't access postgres user):**
If you're using a managed PostgreSQL or don't have postgres superuser access, you may need to:
1. Connect as the database owner
2. Or recreate the database with the correct owner
3. Or use a different user that has superuser privileges

## Security Notes

- Never commit your `.env` file to version control
- Use strong passwords for database users
- Consider using environment-specific configuration files
- For production, use connection pooling and SSL connections

## Advanced: Using Only Local Database

If you want to use only the local database (not recommended for production):

1. Set `DATABASE_URL` to your local database:
```env
DATABASE_URL=postgresql://fincal_user:password@localhost:5432/fincal
```

2. Remove or comment out `LOCAL_DATABASE_URL`

3. Restart your server

## Support

For issues or questions:
- Check PostgreSQL logs: `tail -f /usr/local/var/log/postgres.log` (macOS) or `/var/log/postgresql/` (Linux)
- Verify connection string format: `postgresql://username:password@host:port/database`

