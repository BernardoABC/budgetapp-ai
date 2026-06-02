INSERT INTO category_groups (name, sort_order) VALUES
    ('Immediate Obligations', 1),
    ('Food & Drink',          2),
    ('Transportation',        3),
    ('Personal',              4),
    ('Entertainment',         5),
    ('Savings Goals',         6),
    ('Debt Payments',         7)
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (group_id, name, sort_order)
SELECT g.id, v.cat_name, v.sort_order
FROM category_groups g
JOIN (VALUES
    ('Immediate Obligations', 'Rent/Mortgage',    1),
    ('Immediate Obligations', 'Electricity (ICE)',2),
    ('Immediate Obligations', 'Water (AyA)',      3),
    ('Immediate Obligations', 'Internet',         4),
    ('Immediate Obligations', 'Phone',            5),
    ('Immediate Obligations', 'Insurance (INS)',  6),
    ('Food & Drink',          'Groceries',        1),
    ('Food & Drink',          'Restaurants',      2),
    ('Food & Drink',          'Coffee Shops',     3),
    ('Food & Drink',          'Fast Food',        4),
    ('Transportation',        'Gas',              1),
    ('Transportation',        'Parking',          2),
    ('Transportation',        'Tolls (GLOBALVIA)',3),
    ('Transportation',        'Public Transit',   4),
    ('Transportation',        'Uber/DiDi',        5),
    ('Personal',              'Clothing',         1),
    ('Personal',              'Personal Care',    2),
    ('Personal',              'Medical/Pharmacy', 3),
    ('Entertainment',         'Subscriptions',    1),
    ('Entertainment',         'Entertainment',    2),
    ('Entertainment',         'Hobbies',          3),
    ('Savings Goals',         'Emergency Fund',   1),
    ('Savings Goals',         'Travel',           2),
    ('Savings Goals',         'Investments',      3),
    ('Debt Payments',         'Credit Card Payment', 1),
    ('Debt Payments',         'Loans',            2)
) AS v(group_name, cat_name, sort_order) ON g.name = v.group_name
ON CONFLICT (group_id, name) DO NOTHING;
