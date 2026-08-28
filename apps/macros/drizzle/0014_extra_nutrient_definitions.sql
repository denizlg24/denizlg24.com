-- The nutrition API now returns these nutrients. food_nutrient_values.nutrientKey
-- is a foreign key onto this table, so a definition has to exist before any
-- snapshot can store an amount for them.
--
-- isDefault is false: they are available but not shown by default, so existing
-- users' nutrient views do not change shape without them opting in.
INSERT INTO "nutrient_definitions" ("key", "label", "group", "unit", "sortOrder", "isDefault") VALUES
	('starch', 'Starch', 'macro', 'g', 55, false),
	('sucrose', 'Sucrose', 'macro', 'g', 56, false),
	('glucose', 'Glucose', 'macro', 'g', 57, false),
	('fructose', 'Fructose', 'macro', 'g', 58, false),
	('lactose', 'Lactose', 'macro', 'g', 59, false),
	('maltose', 'Maltose', 'macro', 'g', 60, false),
	('omega3Dpa', 'Omega 3 DPA', 'lipid', 'g', 61, false),
	('folateDfe', 'Folate (DFE)', 'vitamin', 'mcg', 62, false),
	('retinol', 'Retinol', 'vitamin', 'mcg', 63, false),
	('caroteneBeta', 'Beta-carotene', 'vitamin', 'mcg', 64, false),
	('caroteneAlpha', 'Alpha-carotene', 'vitamin', 'mcg', 65, false),
	('cryptoxanthinBeta', 'Beta-cryptoxanthin', 'vitamin', 'mcg', 66, false),
	('lycopene', 'Lycopene', 'vitamin', 'mcg', 67, false),
	('luteinZeaxanthin', 'Lutein + zeaxanthin', 'vitamin', 'mcg', 68, false),
	('ash', 'Ash', 'other', 'g', 69, false),
	('theobromine', 'Theobromine', 'other', 'mg', 70, false)
ON CONFLICT ("key") DO NOTHING;
