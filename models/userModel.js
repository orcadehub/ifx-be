import pool from '../config/db.js';

export const createUser = async (username, email, phone, password) => {
  const query = `
    INSERT INTO users (username, email, phone, password)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const values = [username, email, phone, password];
  const result = await pool.query(query, values);
  return result.rows[0];
};

export const findUserByEmailOrPhone = async (identifier) => {
  const query = `
    SELECT * FROM users
    WHERE email = $1 OR phone = $1;
  `;
  const result = await pool.query(query, [identifier]);
  return result.rows[0];
};
