-- Replace default category groups with the new structure.
-- transactions.category_id is SET NULL on delete, so no transaction data is lost.
DELETE FROM category_groups;

INSERT INTO category_groups (name, sort_order) VALUES
    ('Immediate Obligations', 1),
    ('Expenses',              2),
    ('Just for Fun',          3);

INSERT INTO categories (group_id, name, sort_order)
SELECT g.id, v.cat_name, v.sort_order
FROM category_groups g
JOIN (VALUES
    ('Immediate Obligations', 'Alquiler',                 1),
    ('Immediate Obligations', 'Groceries',               2),
    ('Immediate Obligations', 'Pricesmart',              3),
    ('Immediate Obligations', 'Gas',                     4),
    ('Immediate Obligations', 'Electric',                5),
    ('Immediate Obligations', 'Water',                   6),
    ('Immediate Obligations', 'Internet',                7),
    ('Immediate Obligations', 'Telefono',                8),
    ('Immediate Obligations', 'Chuchis',                 9),
    ('Immediate Obligations', 'Transportation',         10),
    ('Immediate Obligations', 'Seguridad',              11),
    ('Immediate Obligations', 'Interest & Fees',        12),
    ('Expenses',              'Cleaning',                1),
    ('Expenses',              'Medical',                 2),
    ('Expenses',              'Auto Maintenance',        3),
    ('Expenses',              'Home Maintenance',        4),
    ('Expenses',              'Fitness',                 5),
    ('Expenses',              'Beauty',                  6),
    ('Expenses',              'Computer Replacement',    7),
    ('Expenses',              'Software Subscriptions',  8),
    ('Expenses',              'Gifts',                   9),
    ('Expenses',              'Clothing',               10),
    ('Expenses',              'Stuff I Forgot to Budget For', 11),
    ('Just for Fun',          'Trips',                   1),
    ('Just for Fun',          'Gaming',                  2),
    ('Just for Fun',          'Dining Out',              3),
    ('Just for Fun',          'Fun Money',               4),
    ('Just for Fun',          'Ubereats',                5),
    ('Just for Fun',          'Treat yo self',           6)
) AS v(group_name, cat_name, sort_order) ON g.name = v.group_name;
