-- Borrar si existen por si acaso (limpieza profunda)
DROP DATABASE IF EXISTS provider_db;
DROP DATABASE IF EXISTS consumer_db;

-- Crear las bases de datos
CREATE DATABASE provider_db;
CREATE DATABASE consumer_db;
CREATE USER provider_user WITH ENCRYPTED PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE provider_db TO provider_user;
CREATE USER consumer_user WITH ENCRYPTED PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE consumer_db TO consumer_user;