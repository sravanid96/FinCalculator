# FinCal - Personal Finance Dashboard
## Resume Bullet Points

### Project Overview
Built a production-ready personal finance management web application similar to Empower Personal Dashboard, enabling users to aggregate financial data from multiple sources, analyze spending patterns, and track financial goals with comprehensive analytics and visualizations.

### Technical Implementation

• **Full-Stack Architecture**: Developed a responsive web application using React 18 with TypeScript, Node.js/Express backend, and PostgreSQL database with Drizzle ORM, implementing RESTful API design patterns and real-time data synchronization

• **Multi-Source Data Integration**: Implemented dual data ingestion pipelines supporting CSV file uploads with intelligent column mapping and Plaid API integration for automated bank account synchronization, processing transactions from multiple financial institutions (Chase, Capital One, SoFi, etc.)

• **Advanced Analytics Engine**: Built comprehensive financial analytics system calculating income vs expenses, net cash flow, savings rate, and category breakdowns across 7+ time periods (current month, YTD, last year, etc.) with historical trend analysis up to 10 years

• **Intelligent Transaction Processing**: Developed auto-categorization algorithm using keyword matching and machine learning patterns to classify transactions into 15+ expense categories (Housing, Groceries, Transportation, etc.) with manual override capabilities

• **Interactive Data Visualization**: Created dynamic charts and graphs using Recharts library including cash flow trends, income vs expense comparisons, category spending breakdowns (pie charts), and net worth tracking with responsive design for mobile and desktop

• **Drag-and-Drop Category Management**: Implemented intuitive category organization system using @dnd-kit library allowing users to reorganize categories across expense/income/savings/investment sections with real-time type updates

• **Dual Database Architecture**: Designed flexible database system supporting both cloud (Neon, Supabase) and local PostgreSQL databases, enabling users to choose upload destination (cloud-only, local-only, or both) with automatic schema synchronization

• **Authentication & Security**: Implemented secure authentication system with JWT tokens, session management, and user-specific data isolation, ensuring all financial data is encrypted and accessible only to authenticated users

• **Real-Time Query Management**: Integrated React Query for efficient data fetching, caching, and automatic cache invalidation, providing seamless user experience with optimistic updates and error handling

• **Transaction Management System**: Built comprehensive transaction CRUD operations with advanced filtering (date ranges, categories, search), bulk CSV import with duplicate detection, and transaction editing with category reassignment and notes

• **Responsive UI/UX Design**: Created modern, fintech-style interface using Tailwind CSS and shadcn/ui components with dark mode support, mobile-first design, and accessible components following WCAG guidelines

• **Error Handling & Validation**: Implemented robust error handling with Zod schema validation, comprehensive try-catch blocks, and user-friendly error messages throughout the application stack

### Key Features

• **Multi-Account Aggregation**: Connect and manage multiple bank accounts, credit cards, and investment accounts in a unified dashboard with real-time balance tracking

• **Time-Based Analytics**: Generate financial reports across multiple time periods with comparative analysis showing month-over-month and year-over-year trends

• **Category Customization**: Create, edit, and organize custom transaction categories with drag-and-drop functionality, color coding, and icon support

• **CSV Import System**: Intelligent CSV parsing with automatic date format detection, amount normalization, and column mapping for various bank statement formats

• **Plaid Integration**: Secure bank account connection using Plaid Link with OAuth flow, automatic transaction syncing, and account balance updates

• **Financial Reports**: Comprehensive reporting system with income vs expenses charts, category spending breakdowns, top spending categories, and monthly statistics

• **Transaction Search & Filter**: Advanced filtering by date range, category, search terms with pagination support for large transaction datasets

### Technologies Used

**Frontend**: React 18, TypeScript, Tailwind CSS, shadcn/ui, Recharts, React Query, @dnd-kit, Wouter, date-fns

**Backend**: Node.js, Express.js, TypeScript, Drizzle ORM, PostgreSQL, Multer, csv-parse, Plaid API

**Database**: PostgreSQL (cloud: Neon/Supabase, local: Homebrew PostgreSQL)

**Authentication**: JWT, Express Sessions, Passport.js, bcrypt

**DevOps**: Vite, ESLint, TypeScript compiler, Drizzle Kit migrations

### Project Impact

• **Scalability**: Designed to handle thousands of transactions per user with efficient database indexing and query optimization

• **User Experience**: Implemented loading states, skeleton screens, and optimistic UI updates for seamless interactions

• **Data Integrity**: Built transaction deduplication system preventing duplicate entries from CSV imports and Plaid syncs

• **Flexibility**: Dual database support allows users to choose between cloud-only, local-only, or hybrid storage based on privacy and performance needs

### Development Highlights

• Implemented comprehensive error handling and logging throughout the application for production readiness
• Created reusable UI components following component composition patterns
• Optimized database queries with proper indexing and relationship management
• Built responsive design supporting mobile, tablet, and desktop viewports
• Implemented secure file upload handling with validation and sanitization
• Created comprehensive documentation for local database setup and deployment



