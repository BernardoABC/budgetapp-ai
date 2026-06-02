export interface Account {
  id: string;
  name: string;
  balance: number;        // display colones (÷100 of DB centimos)
  type?: string;
  currency?: string;
  on_budget?: boolean;
  closed?: boolean;
  note?: string;
  sort_order?: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  categories: string[];
}

export interface BudgetEntry {
  assigned: number;
  activity: number;
}

export interface Transaction {
  id: string;             // was number; now UUID string from API
  date: string;
  payee: string;
  category: string | null;
  memo: string;
  outflow: number;
  inflow: number;
  cleared: boolean;
  account: string;
  splits?: { category: string; amount: number }[];
}

export interface MonthlySpendingRow {
  month: string;
  housing: number;
  food: number;
  transport: number;
  entertainment: number;
  health: number;
  savings: number;
}

export interface ScheduledTxn {
  id: string;
  next: string;
  payee: string;
  category: string | null;
  amount: number;
  account: string;
  freq: string;
}

export interface PayeeRule {
  id: string;
  match: string;
  category: string;
}

export interface Target {
  type: 'monthly' | 'refill' | 'savings';
  amount: number;
  by?: string;
}

export interface CategoryItemAPI {
  id: string;
  name: string;
  hidden: boolean;
  sort_order: number;
}

export interface CategoryGroupAPI {
  id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
  categories: CategoryItemAPI[];
}

export const AppData = {
  exchangeRate: 510.75,
  exchangeRateDate: 'Apr 14',

  accounts: {
    budget: [
      { id: 'bac',  name: 'BAC Checking', balance: 1250000 },
      { id: 'davi', name: 'Davivienda',   balance: 485300  },
      { id: 'cash', name: 'Efectivo',      balance: 45000   },
    ] as Account[],
    tracking: [
      { id: 'inv',   name: 'Inversión BCR', balance: 3200000 },
      { id: 'sinpe', name: 'SINPE Móvil',   balance: 120000  },
    ] as Account[],
  },

  categoryGroups: [
    { id: 'housing',       name: 'Housing',       categories: ['Rent', 'Electricity', 'Water', 'Internet'] },
    { id: 'food',          name: 'Food & Dining',  categories: ['Groceries', 'Restaurants', 'Coffee'] },
    { id: 'transport',     name: 'Transport',      categories: ['Gas', 'Uber', 'Car Insurance', 'Parking'] },
    { id: 'entertainment', name: 'Entertainment',  categories: ['Streaming', 'Going Out', 'Books'] },
    { id: 'health',        name: 'Health',         categories: ['Gym', 'Doctor', 'Pharmacy'] },
    { id: 'savings',       name: 'Savings',        categories: ['Emergency Fund', 'Investment'] },
  ] as CategoryGroup[],

  budget: {
    'March 2026': {
      'Rent':           { assigned: 450000, activity: -450000 },
      'Electricity':    { assigned: 35000,  activity: -31200  },
      'Water':          { assigned: 12000,  activity: -11000  },
      'Internet':       { assigned: 25000,  activity: -25000  },
      'Groceries':      { assigned: 120000, activity: -118000 },
      'Restaurants':    { assigned: 40000,  activity: -42000  },
      'Coffee':         { assigned: 15000,  activity: -14000  },
      'Gas':            { assigned: 60000,  activity: -58000  },
      'Uber':           { assigned: 20000,  activity: -15000  },
      'Car Insurance':  { assigned: 45000,  activity: -45000  },
      'Parking':        { assigned: 10000,  activity: -8000   },
      'Streaming':      { assigned: 15000,  activity: -15000  },
      'Going Out':      { assigned: 30000,  activity: -28000  },
      'Books':          { assigned: 10000,  activity: -9500   },
      'Gym':            { assigned: 25000,  activity: -25000  },
      'Doctor':         { assigned: 20000,  activity: -20000  },
      'Pharmacy':       { assigned: 10000,  activity: -6000   },
      'Emergency Fund': { assigned: 100000, activity: 0       },
      'Investment':     { assigned: 150000, activity: 0       },
    },
    'April 2026': {
      'Rent':           { assigned: 450000, activity: -450000 },
      'Electricity':    { assigned: 35000,  activity: -28500  },
      'Water':          { assigned: 12000,  activity: -9800   },
      'Internet':       { assigned: 25000,  activity: -25000  },
      'Groceries':      { assigned: 120000, activity: -145000 },
      'Restaurants':    { assigned: 40000,  activity: -38000  },
      'Coffee':         { assigned: 15000,  activity: -18500  },
      'Gas':            { assigned: 60000,  activity: -52000  },
      'Uber':           { assigned: 20000,  activity: -8000   },
      'Car Insurance':  { assigned: 45000,  activity: -45000  },
      'Parking':        { assigned: 10000,  activity: -6000   },
      'Streaming':      { assigned: 15000,  activity: -15000  },
      'Going Out':      { assigned: 30000,  activity: -22000  },
      'Books':          { assigned: 10000,  activity: 0       },
      'Gym':            { assigned: 25000,  activity: -25000  },
      'Doctor':         { assigned: 20000,  activity: 0       },
      'Pharmacy':       { assigned: 10000,  activity: -4500   },
      'Emergency Fund': { assigned: 100000, activity: 0       },
      'Investment':     { assigned: 150000, activity: 0       },
    },
    'May 2026': {
      'Rent':           { assigned: 450000, activity: 0 },
      'Electricity':    { assigned: 35000,  activity: 0 },
      'Water':          { assigned: 12000,  activity: 0 },
      'Internet':       { assigned: 25000,  activity: 0 },
      'Groceries':      { assigned: 120000, activity: 0 },
      'Restaurants':    { assigned: 40000,  activity: 0 },
      'Coffee':         { assigned: 15000,  activity: 0 },
      'Gas':            { assigned: 60000,  activity: 0 },
      'Uber':           { assigned: 20000,  activity: 0 },
      'Car Insurance':  { assigned: 45000,  activity: 0 },
      'Parking':        { assigned: 10000,  activity: 0 },
      'Streaming':      { assigned: 15000,  activity: 0 },
      'Going Out':      { assigned: 30000,  activity: 0 },
      'Books':          { assigned: 10000,  activity: 0 },
      'Gym':            { assigned: 25000,  activity: 0 },
      'Doctor':         { assigned: 20000,  activity: 0 },
      'Pharmacy':       { assigned: 10000,  activity: 0 },
      'Emergency Fund': { assigned: 100000, activity: 0 },
      'Investment':     { assigned: 150000, activity: 0 },
    },
  } as Record<string, Record<string, BudgetEntry>>,

  transactions: [
    { id: '1',  date: '2026-04-18', payee: 'AutoMercado',         category: 'Groceries',   memo: 'Weekly groceries',     outflow: 42500,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '2',  date: '2026-04-17', payee: 'Netflix',             category: 'Streaming',   memo: '',                     outflow: 7500,   inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '3',  date: '2026-04-16', payee: 'Uber',                category: 'Uber',        memo: 'To airport',           outflow: 8000,   inflow: 0,       cleared: false, account: 'bac'  },
    { id: '4',  date: '2026-04-15', payee: 'Empresa — Salario',   category: null,          memo: 'April salary',         outflow: 0,      inflow: 1200000, cleared: true,  account: 'bac'  },
    { id: '5',  date: '2026-04-14', payee: 'Gasolinera Delta',    category: 'Gas',         memo: 'Full tank',            outflow: 28000,  inflow: 0,       cleared: true,  account: 'davi' },
    { id: '6',  date: '2026-04-13', payee: 'La Posada del Valle', category: 'Restaurants', memo: 'Dinner',               outflow: 18500,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '7',  date: '2026-04-12', payee: 'CNFL',                category: 'Electricity', memo: 'April bill',           outflow: 28500,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '8',  date: '2026-04-11', payee: 'Starbucks',           category: 'Coffee',      memo: '',                     outflow: 3500,   inflow: 0,       cleared: true,  account: 'cash' },
    { id: '9',  date: '2026-04-10', payee: 'AYA',                 category: 'Water',       memo: 'April bill',           outflow: 9800,   inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '10', date: '2026-04-08', payee: 'AutoMercado',         category: 'Groceries',   memo: 'Monthly bulk',         outflow: 85000,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '11', date: '2026-04-07', payee: 'RACSA',               category: 'Internet',    memo: 'April plan',           outflow: 25000,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '12', date: '2026-04-05', payee: 'Clínica Bíblica',     category: 'Doctor',      memo: 'Annual checkup',       outflow: 45000,  inflow: 0,       cleared: true,  account: 'davi' },
    { id: '13', date: '2026-04-03', payee: 'SmartFit',            category: 'Gym',         memo: 'April membership',     outflow: 25000,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '14', date: '2026-04-02', payee: 'Propietario',         category: 'Rent',        memo: 'April rent',           outflow: 450000, inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '15', date: '2026-04-01', payee: 'Transfer',            category: 'Investment',  memo: 'To investment fund',   outflow: 150000, inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '16', date: '2026-03-28', payee: 'Farmacia Fischel',    category: 'Pharmacy',    memo: '',                     outflow: 6000,   inflow: 0,       cleared: true,  account: 'davi' },
    { id: '17', date: '2026-03-25', payee: 'AutoMercado',         category: 'Groceries',   memo: 'Weekend shop',         outflow: 38000,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '18', date: '2026-03-22', payee: 'Librería Universal',  category: 'Books',       memo: 'Atomic Habits',        outflow: 9500,   inflow: 0,       cleared: true,  account: 'cash' },
    { id: '19', date: '2026-03-20', payee: 'Empresa — Salario',   category: null,          memo: 'March salary',         outflow: 0,      inflow: 1200000, cleared: true,  account: 'bac'  },
    { id: '20', date: '2026-03-15', payee: 'ICE Kolbi',           category: 'Internet',    memo: 'March plan',           outflow: 25000,  inflow: 0,       cleared: true,  account: 'bac'  },
    { id: '21', date: '2026-04-16', payee: 'Amazon.com',          category: null,          memo: 'Books + subscription', splits: [{ category: 'Books', amount: 12000 }, { category: 'Streaming', amount: 6900 }], outflow: 18900, inflow: 0, cleared: false, account: 'bac' },
    { id: '22', date: '2026-04-12', payee: 'Restaurante Tin Jo',  category: 'Restaurants', memo: 'Lunch',                outflow: 14500,  inflow: 0,       cleared: true,  account: 'davi' },
    { id: '24', date: '2026-04-06', payee: 'Cinépolis',           category: 'Going Out',   memo: 'Movie night',          outflow: 9800,   inflow: 0,       cleared: false, account: 'bac'  },
  ] as Transaction[],

  monthlySpending: [
    { month: 'Nov 25', housing: 522000, food: 145000, transport: 118000, entertainment: 48000,  health: 31000, savings: 100000 },
    { month: 'Dec 25', housing: 522000, food: 215000, transport: 128000, entertainment: 95000,  health: 25000, savings: 100000 },
    { month: 'Jan 26', housing: 522000, food: 162000, transport: 121000, entertainment: 55000,  health: 46000, savings: 250000 },
    { month: 'Feb 26', housing: 522000, food: 148000, transport: 110000, entertainment: 42000,  health: 20000, savings: 100000 },
    { month: 'Mar 26', housing: 522000, food: 174000, transport: 126000, entertainment: 52500,  health: 51000, savings: 150000 },
    { month: 'Apr 26', housing: 513300, food: 201500, transport: 106000, entertainment: 37000,  health: 29500, savings: 150000 },
  ] as MonthlySpendingRow[],

  months: ['March 2026', 'April 2026', 'May 2026'],

  income: {
    'March 2026': 1200000,
    'April 2026': 1200000,
    'May 2026':   1200000,
  } as Record<string, number>,

  openingCarryover: {
    'Emergency Fund': 300000,
    'Investment': 0,
  } as Record<string, number>,

  targets: {
    'Rent':           { type: 'monthly', amount: 450000 },
    'Electricity':    { type: 'monthly', amount: 35000  },
    'Water':          { type: 'monthly', amount: 12000  },
    'Internet':       { type: 'monthly', amount: 25000  },
    'Groceries':      { type: 'refill',  amount: 130000 },
    'Restaurants':    { type: 'refill',  amount: 40000  },
    'Coffee':         { type: 'monthly', amount: 15000  },
    'Gas':            { type: 'monthly', amount: 60000  },
    'Car Insurance':  { type: 'monthly', amount: 45000  },
    'Streaming':      { type: 'monthly', amount: 15000  },
    'Gym':            { type: 'monthly', amount: 25000  },
    'Emergency Fund': { type: 'savings', amount: 1000000, by: 'December 2026' },
    'Investment':     { type: 'monthly', amount: 150000 },
  } as Record<string, Target>,

  scheduled: [
    { id: 's1', next: '2026-05-02', payee: 'Propietario',       category: 'Rent',       amount: -450000, account: 'bac', freq: 'Monthly' },
    { id: 's2', next: '2026-05-03', payee: 'SmartFit',          category: 'Gym',        amount: -25000,  account: 'bac', freq: 'Monthly' },
    { id: 's3', next: '2026-05-05', payee: 'Netflix',           category: 'Streaming',  amount: -7500,   account: 'bac', freq: 'Monthly' },
    { id: 's4', next: '2026-05-07', payee: 'RACSA',             category: 'Internet',   amount: -25000,  account: 'bac', freq: 'Monthly' },
    { id: 's5', next: '2026-05-15', payee: 'Empresa — Salario', category: null,         amount: 1200000, account: 'bac', freq: 'Monthly' },
    { id: 's6', next: '2026-05-20', payee: 'Transfer',          category: 'Investment', amount: -150000, account: 'bac', freq: 'Monthly' },
  ] as ScheduledTxn[],

  payeeRules: [
    { id: 'r1', match: 'AutoMercado', category: 'Groceries' },
    { id: 'r2', match: 'Walmart',     category: 'Groceries' },
    { id: 'r3', match: 'Netflix',     category: 'Streaming' },
    { id: 'r4', match: 'Spotify',     category: 'Streaming' },
    { id: 'r5', match: 'Gasolinera',  category: 'Gas'       },
    { id: 'r6', match: 'Farmacia',    category: 'Pharmacy'  },
    { id: 'r7', match: 'Uber',        category: 'Uber'      },
  ] as PayeeRule[],

  netWorthHistory: [
    { month: 'Nov 25', assets: 3980000, debt: 240000 },
    { month: 'Dec 25', assets: 4120000, debt: 310000 },
    { month: 'Jan 26', assets: 4450000, debt: 205000 },
    { month: 'Feb 26', assets: 4720000, debt: 160000 },
    { month: 'Mar 26', assets: 4910000, debt: 210000 },
    { month: 'Apr 26', assets: 5100300, debt: 184500 },
  ],

  incomeExpense: [
    { month: 'Nov 25', income: 1200000, expense: 964000  },
    { month: 'Dec 25', income: 1200000, expense: 1085000 },
    { month: 'Jan 26', income: 1450000, expense: 856000  },
    { month: 'Feb 26', income: 1200000, expense: 942000  },
    { month: 'Mar 26', income: 1200000, expense: 1075500 },
    { month: 'Apr 26', income: 1200000, expense: 1037300 },
  ],

  ageOfMoney: [
    { month: 'Nov 25', days: 18 },
    { month: 'Dec 25', days: 16 },
    { month: 'Jan 26', days: 24 },
    { month: 'Feb 26', days: 29 },
    { month: 'Mar 26', days: 33 },
    { month: 'Apr 26', days: 38 },
  ],
};
