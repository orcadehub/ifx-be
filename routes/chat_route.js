import express from "express";
import pool from "../config/db.js";
import authenticateToken from "../middlewares/authMiddleware.js";
const router = express.Router();

// ✅ 1. Send a message
router.post("/send", authenticateToken, async (req, res) => {
  const sender_id = req.user.id;
  const { receiver_id, content } = req.body;

  if (!receiver_id || !content) {
    return res.status(400).json({ message: "❌ Missing required fields" });
  }

  try {
    const receiverExists = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [receiver_id]
    );

    if (receiverExists.rowCount === 0) {
      return res.status(404).json({ message: "❌ Receiver not found" });
    }

    await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3)",
      [sender_id, receiver_id, content]
    );

    res.status(200).json({ message: "✅ Message sent and saved to DB" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "❌ Failed to send message" });
  }
});

// ✅ 2. Get all messages between two users
router.get("/chat/:userId", authenticateToken, async (req, res) => {
  const sender_id = req.user.id;
  const receiver_id = req.params.userId;

  try {
    const messages = await pool.query(
      `SELECT id, sender_id, receiver_id, content, timestamp
       FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY timestamp ASC`,
      [sender_id, receiver_id]
    );

    res.status(200).json({ messages: messages.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "❌ Failed to fetch messages" });
  }
});

router.get("/chats", authenticateToken, async (req, res) => {
  const currentUserId = req.user.id;

  try {
    const result = await pool.query(
      `
      SELECT DISTINCT ON (other_user_id)
        CASE
          WHEN m.sender_id = $1 THEN m.receiver_id
          ELSE m.sender_id
        END AS other_user_id,
        u.fullname AS other_user_name,
        m.content AS last_message,
        m.timestamp
      FROM messages m
      JOIN users u
        ON u.id = CASE
                   WHEN m.sender_id = $1 THEN m.receiver_id
                   ELSE m.sender_id
                 END
      WHERE m.sender_id = $1 OR m.receiver_id = $1
      ORDER BY other_user_id, m.timestamp DESC
    `,
      [currentUserId]
    );

    res.status(200).json({ chats: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "❌ Failed to fetch chats" });
  }
});

router.get("/users", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    console.log("triggered");
    const result = await pool.query(
      `SELECT id, fullname, email,role FROM users WHERE id != $1 ORDER BY fullname`,
      [currentUserId]
    );

    res.status(200).json({ users: result.rows });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "❌ Failed to fetch users" });
  }
});

export default router;
