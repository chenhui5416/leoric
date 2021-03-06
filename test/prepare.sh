cat <<EOF | mysql -uroot
CREATE DATABASE IF NOT EXISTS leoric;
USE leoric;
source test/dumpfile.sql;
EOF

createdb leoric > /dev/null 2>&1 || true
cat test/dumpfile.sql |
  sed 's/`/"/g' |
  sed 's/bigint(20) AUTO_INCREMENT/BIGSERIAL/g' |
  sed 's/tinyint(1) DEFAULT 0/boolean DEFAULT false/g' |
  sed -E 's/int\([[:digit:]]+\)/int/g' |
  sed 's/datetime/timestamp/g' |
  psql -d leoric

# SQLite perfers `AUTOINCREMENT` to `AUTO_INCREMENT`. Yet `AUTOINCREMENT` isn't available on columns not marked as `PRIMARY KEY`. As of `PRIMARY KEY`, with or without `AUTOINCREMENT` isn't much of difference.
# - https://sqlite.org/autoinc.html
sed 's/bigint(20) AUTO_INCREMENT/INTEGER/' test/dumpfile.sql | sqlite3 /tmp/leoric.sqlite3
# npm rebuild sqlite3 --build-from-source

# References:
# - https://www.postgresql.org/docs/9.1/static/datatype-datetime.html
# - https://www.postgresql.org/docs/9.1/static/datatype-numeric.html
