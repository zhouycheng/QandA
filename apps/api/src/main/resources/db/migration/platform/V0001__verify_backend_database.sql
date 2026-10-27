DO $$
BEGIN
    IF current_database() <> 'qanda_backend' THEN
        RAISE EXCEPTION 'Platform migrations require the dedicated qanda_backend database';
    END IF;
END
$$;
