import express from "express";
import Busboy from "busboy";
import cloudinaryPkg from "cloudinary";
import pool from "../config/db.js";
import authenticateToken from "../middlewares/authMiddleware.js";

const router = express.Router();
const cloudinary = cloudinaryPkg.v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


// Place a new order
router.post("/place-order", authenticateToken, (req, res) => {
  const busboy = Busboy({ headers: req.headers });

  let orderData = {};
  let fileUploadPromise = null;

  busboy.on("field", (fieldname, val) => {
    try {
      if (["services", "affiliatedLinks"].includes(fieldname)) {
        orderData[fieldname] = JSON.parse(val); // Parse JSON fields
      } else {
        orderData[fieldname] = val;
      }
      console.log(`Field ${fieldname}:`, val); // Debug log
    } catch (err) {
      console.error(`Error parsing field ${fieldname}:`, err.message);
    }
  });

  busboy.on("file", (fieldname, file, filename) => {
    fileUploadPromise = new Promise((resolve, reject) => {
      const safeFilename =
        typeof filename === "string" ? filename : "uploaded_file";
      const publicId = safeFilename.split(".")[0];

      const stream = cloudinary.uploader.upload_stream(
        { resource_type: "raw", folder: "documents", public_id: publicId },
        (err, result) => {
          if (err) return reject(err);
          resolve(result.secure_url);
        }
      );

      file.pipe(stream);
    });
  });

  busboy.on("finish", async () => {
    try {
      const file_url = fileUploadPromise ? await fileUploadPromise : null;

      const {
        userId,
        influencerId,
        services,
        totalPrice,
        description,
        affiliatedLinks,
        couponCode,
        postDateTime,
        username: frontendUsername,
        type,
        influencer_name,
      } = orderData;

      console.log("Received Order Data:", orderData); // Debug log

      if (
        !userId ||
        !influencerId ||
        !services ||
        !totalPrice ||
        !type ||
        !influencer_name
      ) {
        return res.status(400).json({ message: "❌ Missing required fields" });
      }

      if (userId != req.user.id) {
        return res.status(403).json({ message: "❌ Unauthorized user ID" });
      }

      const userQuery = `SELECT username FROM users WHERE id = $1`;
      const userResult = await pool.query(userQuery, [influencerId]);
      if (!userResult.rows[0]) {
        return res.status(404).json({ message: "❌ Influencer not found" });
      }
      const username = userResult.rows[0].username;

      let scheduledDate = null,
        scheduledTime = null;
      if (postDateTime) {
        const postDate = new Date(postDateTime);
        scheduledDate = postDate.toISOString().split("T")[0];
        scheduledTime = postDate.toTimeString().split(" ")[0];
      }

      const insertQuery = `
        INSERT INTO orders (
          user_id,
          influencer_id,
          services,
          total_price,
          description,
          affiliated_links,
          coupon_code,
          post_datetime,
          file_url,
          created_at,
          username,
          order_date,
          scheduled_date,
          scheduled_time,
          order_type,
          amount,
          inf_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *;
      `;

      const values = [
        userId,
        influencerId,
        services.map((s) => JSON.stringify(s)), // Ensure services are stored as JSON
        parseFloat(totalPrice),
        description || null,
        affiliatedLinks || [], // Store affiliatedLinks as JSON array
        couponCode || null,
        postDateTime || null,
        file_url,
        new Date(),
        frontendUsername,
        new Date(),
        scheduledDate,
        scheduledTime,
        type,
        parseFloat(totalPrice),
        influencer_name,
      ];

      const result = await pool.query(insertQuery, values);

      res
        .status(200)
        .json({ message: "Order placed successfully", order: result.rows[0] });
    } catch (err) {
      console.error("Order Insert Error:", err.message);
      res.status(500).json({ message: "❌ Failed to place order" });
    }
  });

  req.pipe(busboy);
});

// GET /orders

// Get user orders, sorted by most recent first
router.get("/orders", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let query = `
      SELECT 
        o.id,
        o.user_id,
        o.influencer_id,
        o.username,
        o.order_date,
        o.scheduled_date,
        o.scheduled_time,
        o.services,
        o.total_price AS amount,
        o.description,
        o.affiliated_links,
        o.coupon_code,
        o.file_url,
        o.order_type,
        o.created_at,
        o.status,
        o.inf_name
      FROM orders o
      WHERE o.user_id = $1 OR o.influencer_id = $1
      ORDER BY o.created_at DESC
    `;
    const values = [userId];

    const result = await pool.query(query, values);

    const formattedOrders = result.rows.map((order) => {
      const firstService =
        order.services && order.services.length > 0
          ? order.services[0]
          : JSON.stringify({ name: "Custom Service", type: "General" });

      return {
        id: order.id,
        userId: order.user_id,
        influencerId: order.influencer_id,
        username: order.username || "Unknown",
        orderDate: order.order_date,
        scheduledDate: order.scheduled_date
          ? new Date(order.scheduled_date).toISOString().split("T")[0]
          : null,
        scheduledTime: order.scheduled_time,
        type: order.order_type,
        product: JSON.parse(firstService).name || "Custom Service",
        amount: parseFloat(order.amount || 0),
        orderType: order.order_type,
        description: order.description,
        affiliatedLinks: order.affiliated_links || [],
        couponCode: order.coupon_code,
        file: order.file_url,
        status: order.status || "Pending",
        infName: order.inf_name || "Unknown",
      };
    });

    res.status(200).json({ orders: formattedOrders });
  } catch (err) {
    console.error("Error fetching orders:", err.message);
    res.status(500).json({ message: "❌ Failed to fetch orders" });
  }
});

// DELETE /orders/:id
router.delete("/orders/:id", authenticateToken, async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;

    const orderQuery = `
      SELECT user_id, influencer_id, file_url 
      FROM orders 
      WHERE id = $1
    `;
    const orderResult = await pool.query(orderQuery, [orderId]);

    if (!orderResult.rows[0]) {
      return res.status(404).json({ message: "❌ Order not found" });
    }

    const order = orderResult.rows[0];

    if (order.user_id == userId || order.influencer_id == userId) {
      const deleteQuery = `DELETE FROM orders WHERE id = $1 RETURNING *`;
      const deleteResult = await pool.query(deleteQuery, [orderId]);

      if (deleteResult.rows[0]) {
        if (deleteResult.rows[0].file_url) {
          const publicId = deleteResult.rows[0].file_url
            .split("/")
            .pop()
            .split(".")[0];
          try {
            await cloudinary.uploader.destroy(`documents/${publicId}`, {
              resource_type: "raw",
            });
          } catch (cloudinaryErr) {
            console.error(
              "Error deleting file from Cloudinary:",
              cloudinaryErr.message
            );
          }
        }

        return res.status(200).json({ message: "Order deleted successfully" });
      } else {
        return res.status(404).json({ message: "❌ Order not found" });
      }
    } else {
      return res
        .status(403)
        .json({ message: "❌ Unauthorized to delete this order" });
    }
  } catch (err) {
    console.error("Error deleting order:", err.message);
    res.status(500).json({ message: "❌ Failed to delete order" });
  }
});

export default router;
