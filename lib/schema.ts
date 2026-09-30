// Sample "company" database used until someone uploads their own data:
// departments, employees, projects, and who's assigned to what.
// Enough structure (foreign keys, dates, salaries) to write real joins against.
export const SEED_SQL = `
CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  budget INTEGER NOT NULL
);

CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  salary INTEGER NOT NULL,
  hire_date TEXT NOT NULL,
  manager_id INTEGER REFERENCES employees(id)
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  start_date TEXT NOT NULL,
  end_date TEXT,
  budget INTEGER NOT NULL
);

CREATE TABLE project_assignments (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  project_id INTEGER REFERENCES projects(id),
  role TEXT NOT NULL,
  hours_per_week INTEGER NOT NULL
);

INSERT INTO departments (id, name, budget) VALUES
  (1, 'Engineering', 4200000),
  (2, 'Sales', 1800000),
  (3, 'Marketing', 950000),
  (4, 'People Ops', 600000),
  (5, 'Finance', 700000);

INSERT INTO employees (id, name, email, department_id, salary, hire_date, manager_id) VALUES
  (1, 'Ravi Menon', 'ravi.menon@company.com', 1, 2400000, '2019-03-11', NULL),
  (2, 'Ananya Iyer', 'ananya.iyer@company.com', 1, 1800000, '2020-06-01', 1),
  (3, 'Devika Rao', 'devika.rao@company.com', 1, 1650000, '2021-01-15', 1),
  (4, 'Karan Sethi', 'karan.sethi@company.com', 1, 1550000, '2022-08-22', 2),
  (5, 'Priya Nair', 'priya.nair@company.com', 2, 2100000, '2018-11-02', NULL),
  (6, 'Arjun Kapoor', 'arjun.kapoor@company.com', 2, 1400000, '2021-04-19', 5),
  (7, 'Meera Das', 'meera.das@company.com', 2, 1350000, '2022-02-07', 5),
  (8, 'Nikhil Verma', 'nikhil.verma@company.com', 3, 1700000, '2019-09-30', NULL),
  (9, 'Simran Kaur', 'simran.kaur@company.com', 3, 1250000, '2023-01-10', 8),
  (10, 'Aditya Joshi', 'aditya.joshi@company.com', 4, 1300000, '2020-02-18', NULL),
  (11, 'Isha Bhatt', 'isha.bhatt@company.com', 4, 1150000, '2022-11-05', 10),
  (12, 'Rohit Malhotra', 'rohit.malhotra@company.com', 5, 1900000, '2017-07-21', NULL),
  (13, 'Tanya Chawla', 'tanya.chawla@company.com', 5, 1400000, '2021-10-12', 12),
  (14, 'Vikram Shah', 'vikram.shah@company.com', 1, 1600000, '2023-05-03', 1);

INSERT INTO projects (id, name, department_id, start_date, end_date, budget) VALUES
  (1, 'Checkout Revamp', 1, '2025-01-06', '2025-06-30', 3200000),
  (2, 'Mobile App v2', 1, '2025-03-01', NULL, 4100000),
  (3, 'Q1 Outbound Campaign', 2, '2025-01-15', '2025-03-31', 600000),
  (4, 'Enterprise Expansion', 2, '2025-04-01', NULL, 1100000),
  (5, 'Brand Refresh', 3, '2025-02-01', '2025-05-15', 400000),
  (6, 'Payroll Migration', 5, '2025-01-01', '2025-04-30', 350000);

INSERT INTO project_assignments (id, employee_id, project_id, role, hours_per_week) VALUES
  (1, 1, 1, 'Tech Lead', 20),
  (2, 2, 1, 'Backend Engineer', 35),
  (3, 3, 1, 'Frontend Engineer', 35),
  (4, 4, 2, 'Backend Engineer', 40),
  (5, 14, 2, 'QA Engineer', 30),
  (6, 2, 2, 'Backend Engineer', 15),
  (7, 5, 3, 'Campaign Lead', 25),
  (8, 6, 3, 'Sales Rep', 20),
  (9, 7, 4, 'Sales Rep', 30),
  (10, 5, 4, 'Account Executive', 20),
  (11, 8, 5, 'Creative Lead', 25),
  (12, 9, 5, 'Designer', 35),
  (13, 12, 6, 'Finance Lead', 15),
  (14, 13, 6, 'Analyst', 30);
`;
