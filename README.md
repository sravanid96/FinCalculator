
# Finance Dashboard (FinCal)

A comprehensive personal finance management application that helps you aggregate all your financial accounts, track spending patterns, and gain powerful insights to make smarter money decisions.

### Finance Dashboard Landing Page

<img width="1476" height="1044" alt="Screenshot 2026-01-04 at 8 14 19 PM" src="https://github.com/user-attachments/assets/8411593b-a7e7-4f11-b350-b916c85bb778" />
<img width="1358" height="957" alt="Screenshot 2026-01-04 at 8 21 24 PM" src="https://github.com/user-attachments/assets/180bced0-13e6-41b9-9418-2329b4003023" />

## 🚀 Features
<img width="1728" height="880" alt="Screenshot 2026-01-04 at 8 22 21 PM" src="https://github.com/user-attachments/assets/49076dc4-b109-4dbd-90e8-8cecde6f988c" />

### Core Functionality
- **Smart Analytics**: Powerful insights into your spending patterns with customizable time periods and category breakdowns
- **Bank-Level Security**: Connect your accounts securely through Plaid. We never store your bank credentials
- **Auto-Categorization**: Transactions are automatically categorized with the ability to customize and create your own categories
- **Mobile Friendly**: Access your financial dashboard anywhere with a fully responsive design that works on any device
<img width="1461" height="800" alt="Screenshot 2026-01-04 at 8 23 10 PM" src="https://github.com/user-attachments/assets/2d1f897c-e0e9-4f3d-bcfc-07bde1c95832" />
<img width="1656" height="860" alt="Screenshot 2026-01-04 at 8 23 34 PM" src="https://github.com/user-attachments/assets/e6102d6e-361f-4fcb-b1a5-85c210c3059f" />
### Key 
Capabilities
- ✅ Connect multiple bank accounts via Plaid integration
- ✅ Manual account creation and transaction entry
- ✅ CSV transaction import with auto-categorization
- ✅ Drag-and-drop category management (move categories between income/expense)
- ✅ Flexible date filtering (All Time, Year to Date, Last 1 Year, Last Year, Custom ranges)
- ✅ Real-time analytics dashboard with:
  - Total Income & Expenses
  - Savings Rate calculation
  - Cash Flow Trends (area chart)
  - Spending by Category (pie chart)
- ✅ Comprehensive reports with income vs expenses visualization
- ✅ Transaction management (edit, delete, change categories)
- ✅ Dark/Light mode support
- ✅ Dual database support (Cloud PostgreSQL + Local PostgreSQL)

<img width="1706" height="799" alt="Screenshot 2026-01-04 at 8 24 41 PM" src="https://github.com/user-attachments/assets/29b9e787-118c-403b-b977-8036e5b625c9" />

## 🛠️ Tech Stack


### Frontend
- **React 18** with TypeScript
- **Vite** for build tooling
- **TanStack Query** for data fetching
- **Recharts** for data visualization
- **shadcn/ui** component library
- **Tailwind CSS** for styling
- **@dnd-kit** for drag-and-drop functionality
- **Wouter** for routing

### Backend
- **Node.js** with **Express**
- **TypeScript** for type safety
- **Drizzle ORM** for database management
- **PostgreSQL** (Neon Cloud + Local)
- **Plaid API** for bank account integration
- **JWT** for authentication
- **Express Sessions** for session management

### Additional Tools
- **CSV parsing** for transaction imports
- **bcrypt** for password hashing
- **date-fns** for date manipulation
- **Zod** for schema validation

## 📋 Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL (for local database - optional)
- Plaid account credentials (optional, for bank connections)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd FinCal
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   # Database
   DATABASE_URL=your_neon_postgresql_connection_string
   LOCAL_DATABASE_URL=postgresql://user:password@localhost:5432/fincal_local
   
   # Server
   PORT=3000
   NODE_ENV=development
   
   # JWT Secret
   JWT_SECRET=your_jwt_secret_key
   
   # Session Secret
   SESSION_SECRET=your_session_secret_key
   
   # Plaid (Optional - for bank connections)
   PLAID_CLIENT_ID=your_plaid_client_id
   PLAID_SECRET=your_plaid_secret
   PLAID_ENV=sandbox
   ```

4. **Set up the database**
   
   For cloud database (Neon):
   ```bash
   npm run db:push
   ```
   
   For local database (optional):
   - See [LOCAL_DB_SETUP.md](./LOCAL_DB_SETUP.md) for detailed instructions
   - After setup, run: `npm run db:push:local`

## 🚀 Running the Application

### Development Mode
```bash
npm run dev
```

The application will be available at `http://localhost:3000` (or the port specified in your `.env` file).

**Note**: If port 5000 is in use (e.g., by macOS AirPlay), the server will automatically use port 3000.

### Production Build
```bash
npm run build
npm start
```

## 📖 Usage Guide

### Getting Started

1. **Sign Up / Log In**
   - Create a new account or log in with existing credentials
   - Your session is securely managed with JWT tokens

2. **Connect Bank Accounts**
   - Click "Connect with Bank" on the Accounts page
   - Use Plaid Link to securely connect your bank accounts
   - Transactions will automatically sync

3. **Import Transactions via CSV**
   - Navigate to Accounts page
   - Click "Upload CSV"
   - Choose upload destination:
     - Cloud Database Only
     - Local Database Only
     - Both Databases
   - Select your CSV file (format: date, description, amount)
   - Transactions will be auto-categorized

4. **Manage Categories**
   - Go to Categories page
   - Create custom categories with colors
   - Drag and drop categories between Income and Expense sections
   - Edit or delete categories as needed

5. **View Analytics**
   - Dashboard shows real-time financial metrics
   - Filter by time period (All Time, YTD, Last Year, etc.)
   - View cash flow trends and category breakdowns

6. **Generate Reports**
   - Access detailed reports on the Reports page
   - Export data for external analysis

### Transaction Management

- **Edit Transactions**: Click on any transaction to edit details
- **Change Category**: Use the dropdown menu on transaction rows
- **Delete Transactions**: Remove transactions (permanently deleted from database)
- **Filter by Date**: Use the date filter dropdown for custom time ranges

## 📁 Project Structure

```
FinCal/
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Utility functions
│   └── public/             # Static assets
├── server/                 # Backend Express application
│   ├── routes.ts           # API route handlers
│   ├── storage.ts          # Database operations
│   ├── plaid.ts            # Plaid integration
│   ├── auth.ts             # Authentication logic
│   └── db.ts               # Database connection
├── shared/                 # Shared types and schemas
│   └── schema.ts           # Drizzle schema definitions
├── docs/                   # Documentation
│   └── images/             # Screenshots and images
└── script/                 # Build scripts
```

## 🔐 Security Features

- JWT-based authentication
- Secure password hashing with bcrypt
- Session management
- Plaid integration (bank credentials never stored)
- Environment variable protection
- CORS configuration

## 🗄️ Database Options

### Cloud Database (Neon)
- Primary database for production use
- Automatically synced with all operations
- Accessible from anywhere

### Local Database (PostgreSQL)
- Optional local storage
- Useful for development and testing
- See [LOCAL_DB_SETUP.md](./LOCAL_DB_SETUP.md) for setup

### CSV Upload Options
When uploading CSV files, you can choose:
- **Cloud Database Only**: Store in Neon cloud
- **Local Database Only**: Store in local PostgreSQL
- **Both Databases**: Store in both simultaneously

## 🧪 Development

### Type Checking
```bash
npm run check
```

### Database Migrations
```bash
# Push schema to cloud database
npm run db:push

# Push schema to local database
npm run db:push:local
```

## 📝 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user

### Accounts
- `GET /api/accounts` - Get all accounts
- `POST /api/accounts` - Create manual account
- `POST /api/accounts/:id/sync` - Sync Plaid account

### Transactions
- `GET /api/transactions` - Get transactions (with filters)
- `POST /api/transactions` - Create transaction
- `PUT /api/transactions/:id` - Update transaction
- `DELETE /api/transactions/:id` - Delete transaction
- `POST /api/transactions/upload` - Upload CSV

### Analytics & Reports
- `GET /api/analytics?timePeriod=...` - Get analytics data
- `GET /api/reports?timePeriod=...` - Get reports data

### Categories
- `GET /api/categories` - Get all categories
- `POST /api/categories` - Create category
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category

### Plaid
- `POST /api/plaid/link-token` - Get Plaid Link token
- `POST /api/plaid/exchange-token` - Exchange public token

## 🐛 Troubleshooting

### Port Already in Use
If you see "Access to localhost was denied":
- Port 5000 may be used by macOS AirPlay
- Solution: Use port 3000 (set `PORT=3000` in `.env`)

### Database Connection Issues
- Verify your `DATABASE_URL` is correct
- Check if PostgreSQL is running (for local DB)
- Ensure database credentials are valid

### Plaid Connection Errors
- Verify `PLAID_CLIENT_ID` and `PLAID_SECRET` are set
- Ensure Plaid package is installed: `npm install plaid`
- Check Plaid environment (sandbox/development/production)

### CSV Import Shows $0.00
- Ensure CSV format is correct (date, description, amount)
- Check that amounts are numeric values
- Verify account balance calculation logic

## 📄 License

MIT License - see LICENSE file for details

## 👥 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on the repository.

---

**Built with ❤️ using React, TypeScript, and PostgreSQL**

