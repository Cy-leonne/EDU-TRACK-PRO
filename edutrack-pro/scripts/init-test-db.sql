-- Creates the shadow and test databases used by Prisma migrate dev and the
-- integration test suite. Executed automatically by docker-compose.
CREATE DATABASE edutrack_pro_shadow OWNER edutrack;
CREATE DATABASE edutrack_pro_test OWNER edutrack;
