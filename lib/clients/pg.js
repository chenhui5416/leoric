'use strict'

const { Pool } = require('pg')
const SqlString = require('sqlstring')
const debug = require('debug')('leoric')

/**
 * The actual column type can be found by mapping the `oid` (which is called `dataTypeID`) in the `RowDescription`.
 * - https://stackoverflow.com/questions/11829368/how-can-i-see-the-postgresql-column-type-from-a-rowdescription-message
 * - https://www.postgresql.org/docs/8.4/static/catalog-pg-type.html
 * - https://www.postgresql.org/docs/9.1/static/protocol-message-formats.html
 * - https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat
 */
const pgType = {
  20: { oid: 20, typname: 'int8', type: Number }
}

/**
 * Postgres tend to keep the returned value as string, even if the column type specified is something like 8 byte int. Hence this function is necessary to find the actual column type, and cast the string to the correct type if possible.
 * @param {*} value
 * @param {Object} field
 */
function cast(value, field) {
  const opts = pgType[field.dataTypeID]

  if (opts) {
    try {
      return opts.type(value)
    } catch (err) {
      debug('unable to cast %s to type %s', value, opts)
    }
  }
  return value
}

/**
 * Postgres returns a nested array when `rowMode` is `array`:
 *
 *     [ [ 1, 'New Post' ] ]
 *
 * the corresponding fields would be:
 *
 *     [ { tableID: 15629, dataTypeID: 20, name: 'id' },
 *       { tableID: 15629, dataTypeID: 20, name: 'title' } ]
 *
 * This function is to turn above rows into nested objects with qualifers as keys:
 *
 *     [ { articles: { id: 1, title: 'New Post' } } ]
 *
 * @param {Array} rows
 * @param {Array} fields
 * @param {Spell} spell
 */
function nest(rows, fields, spell) {
  const results = []
  const qualifiers = [spell.Model.aliasName, ...Object.keys(spell.joins)]

  for (const row of rows) {
    const result = {}
    let tableIndex = 0
    let tableIDWas
    let qualifier

    for (let i = 0; i < fields.length; i++) {
      const { name, tableID } = fields[i]
      if (tableID !== tableIDWas) {
        qualifier = tableID !== 0 ? qualifiers[tableIndex++] : ''
        tableIDWas = tableID
      }
      const obj = result[qualifier] || (result[qualifier] = {})
      obj[name] = cast(row[i], fields[i])
    }
    results.push(result)
  }

  return { rows: results, fields }
}

/**
 * The `... IS NULL` predicate is not parameterizable.
 * - https://github.com/brianc/node-postgres/issues/1751
 * @param {string} sql
 * @param {Array} values
 */
function prepare(sql, values) {
  let i = 0
  const text = sql.replace(/\?/g, () => `$${++i}`)
  i = 0
  debug(sql.replace(/\?/g, () => SqlString.escape(values[i++])))
  return { text, values }
}

const Leoric_connection = {
  async Leoric_query(opts, values) {
    if (typeof opts === 'string') opts = { sql: opts }
    const { sql, nestTables, spell } = opts
    const query = prepare(sql, values)

    if (nestTables) {
      const { rows, fields } = await this.query({ ...query, rowMode: 'array' })
      return nest(rows, fields, spell)
    }
    else if (/^insert/i.test(sql)) {
      const { primaryColumn } = spell.Model
      const key = this.escapeId(primaryColumn)
      const result = await this.query({ ...query, text: `${query.text} RETURNING ${key}` })
      const { rows, rowCount, fields } = result
      let insertId
      for (const field of fields) {
        if (field.name == primaryColumn) {
          insertId = cast(rows[0][primaryColumn], field)
        }
      }
      return { insertId, affectedRows: rowCount }
    }
    else if (/^(?:update|delete)/i.test(sql)) {
      const { rowCount: affectedRows } = await this.query(query)
      return { affectedRows }
    }
    else {
      return this.query(query)
    }
  },
  escapeId(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`
  }
}

function Leoric_pg({ host, port, user, password, database }) {
  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
  })

  return Object.assign(pool, {
    Leoric_type: 'pg',
    async Leoric_getConnection() {
      return Object.assign(await pool.connect(), Leoric_connection)
    }
  }, Leoric_connection)
}

module.exports = Leoric_pg
