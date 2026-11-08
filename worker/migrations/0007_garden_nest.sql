-- 园中园：parent_id 是上一层园地，最外面的园地为空。created_by 是开这块园地的人（可能是一起写的人）
ALTER TABLE gardens ADD COLUMN parent_id INTEGER;
ALTER TABLE gardens ADD COLUMN created_by INTEGER;
CREATE INDEX gardens_parent ON gardens (parent_id);
