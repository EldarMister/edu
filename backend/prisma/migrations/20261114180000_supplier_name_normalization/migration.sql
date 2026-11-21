-- C-locale PostgreSQL does not case-fold Cyrillic. Fold it explicitly so
-- Russian supplier aliases are merged consistently on every installation.
CREATE TEMP TABLE supplier_aliases ON COMMIT PRESERVE ROWS AS
SELECT id, first_value(id) OVER (PARTITION BY cafe_id,
 lower(translate(trim(name),'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя')) ORDER BY is_active DESC, id) AS canonical_id
FROM warehouse_suppliers;
UPDATE purchases p SET supplier_id=a.canonical_id FROM supplier_aliases a WHERE p.supplier_id=a.id AND a.id<>a.canonical_id;
UPDATE ingredients i SET supplier_id=a.canonical_id FROM supplier_aliases a WHERE i.supplier_id=a.id AND a.id<>a.canonical_id;
UPDATE warehouse_suppliers s SET is_active=false FROM supplier_aliases a WHERE s.id=a.id AND a.id<>a.canonical_id;
DROP TABLE supplier_aliases;
CREATE UNIQUE INDEX warehouse_suppliers_cafe_normalized_name_key ON warehouse_suppliers
(cafe_id, lower(translate(trim(name),'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя'))) WHERE is_active;
