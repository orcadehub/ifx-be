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
router.post("/place-order", authenticateToken, async (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  const startTime = new Date().toISOString(); // Timestamp for debugging

  let orderData = {};
  let fileUrl = null;

  busboy.on("field", (fieldname, val) => {
    try {
      if (["services", "affiliatedLinks"].includes(fieldname)) {
        orderData[fieldname] = JSON.parse(val); // Parse JSON fields
      } else {
        orderData[fieldname] = val;
      }
      console.log(`[${startTime}] Field [${fieldname}]:`, val); // Debug log with timestamp
    } catch (err) {
      console.error(
        `[${startTime}] Error parsing field [${fieldname}]: ${err.message}`
      );
      orderData[fieldname] = val; // Fallback to raw value
    }
  });

  busboy.on("file", (fieldname, file, filename) => {
    const safeFilename = filename
      ? filename.toString().split(".")[0]
      : `uploaded_file_${Date.now()}`;
    const uploadPromise = new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: "raw",
          folder: "orders",
          public_id: safeFilename,
          overwrite: true,
        },
        (err, result) => {
          if (err) {
            console.error(`[${startTime}] Cloudinary upload error:`, err);
            return reject(err);
          }
          resolve(result.secure_url);
        }
      );
      file.pipe(stream);
    });

    uploadPromise
      .then((url) => {
        fileUrl = url;
        console.log(`[${startTime}] File uploaded successfully: ${url}`);
      })
      .catch((err) => {
        console.error(`[${startTime}] File upload failed: ${err.message}`);
      });
  });

  busboy.on("finish", async () => {
    try {
      console.log(`[${startTime}] Processing order data:`, orderData); // Log received data
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

      // Validate required fields with fallback for totalPrice
      if (!userId || !influencerId || !services || !type || !influencer_name) {
        console.log(`[${startTime}] Validation failed - Missing fields:`, {
          userId,
          influencerId,
          services,
          totalPrice,
          type,
          influencer_name,
        });
        return res.status(400).json({
          message:
            "Missing required fields: userId, influencerId, services, totalPrice, type, or influencer_name",
        });
      }

      // Calculate totalPrice if not provided (fallback)
      let parsedTotalPrice = parseFloat(totalPrice);
      if (isNaN(parsedTotalPrice) || parsedTotalPrice < 0) {
        let calculatedTotalPrice = 0;
        try {
          const parsedServices = Array.isArray(services)
            ? services
            : JSON.parse(services);
          calculatedTotalPrice = parsedServices.reduce(
            (sum, s) => sum + (parseFloat(s.price) || 0),
            0
          );
        } catch (err) {
          console.log(
            `[${startTime}] Failed to calculate totalPrice:`,
            err.message
          );
        }
        parsedTotalPrice = calculatedTotalPrice > 0 ? calculatedTotalPrice : 0;
        console.log(
          `[${startTime}] Using calculated totalPrice:`,
          parsedTotalPrice
        );
      }

      // Validate user authorization
      if (userId != req.user.id) {
        console.log(`[${startTime}] Unauthorized user ID mismatch:`, {
          userId,
          reqUserId: req.user.id,
        });
        return res
          .status(403)
          .json({ message: "Unauthorized user ID mismatch" });
      }

      // Check database connection
      try {
        await pool.query("SELECT 1");
        console.log(`[${startTime}] Database connection successful`);
      } catch (connErr) {
        console.error(
          `[${startTime}] Database connection error:`,
          connErr.message
        );
        return res.status(500).json({ message: "Database connection failed" });
      }

      // Check if influencer exists
      const userQuery = `SELECT username FROM users WHERE id = $1`;
      const userResult = await pool.query(userQuery, [influencerId]);
      if (!userResult.rows[0]) {
        console.log(
          `[${startTime}] Influencer not found for ID:`,
          influencerId
        );
        return res.status(404).json({ message: "Influencer not found" });
      }
      const username = userResult.rows[0].username || frontendUsername;

      // Validate services
      let parsedServices = [];
      try {
        parsedServices = Array.isArray(services)
          ? services
          : JSON.parse(services);
        if (!Array.isArray(parsedServices) || parsedServices.length === 0) {
          throw new Error("Services must be a non-empty array");
        }
      } catch (err) {
        console.log(
          `[${startTime}] Invalid services format:`,
          err.message,
          services
        );
        return res
          .status(400)
          .json({ message: `Invalid services format: ${err.message}` });
      }

      // Validate affiliatedLinks
      let parsedAffiliatedLinks = [];
      try {
        parsedAffiliatedLinks = Array.isArray(affiliatedLinks)
          ? affiliatedLinks
          : JSON.parse(affiliatedLinks);
        if (!Array.isArray(parsedAffiliatedLinks)) {
          throw new Error("Affiliated links must be an array");
        }
      } catch (err) {
        console.log(
          `[${startTime}] Invalid affiliatedLinks format:`,
          err.message,
          affiliatedLinks
        );
        return res
          .status(400)
          .json({ message: `Invalid affiliatedLinks format: ${err.message}` });
      }

      // Handle postDateTime
      let scheduledDate = null,
        scheduledTime = null;
      if (postDateTime) {
        const postDate = new Date(postDateTime);
        if (isNaN(postDate.getTime())) {
          console.log(
            `[${startTime}] Invalid post date/time format:`,
            postDateTime
          );
          return res
            .status(400)
            .json({ message: "Invalid post date/time format" });
        }
        scheduledDate = postDate.toISOString().split("T")[0];
        scheduledTime = postDate.toTimeString().split(" ")[0];
      }

      // Start a transaction
      await pool.query("BEGIN");
      console.log(`[${startTime}] Transaction started`);

      // Database insertion
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
          username,
          order_date,
          scheduled_date,
          scheduled_time,
          order_type,
          amount,
          inf_name,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *;
      `;

      const values = [
        userId,
        influencerId,
        JSON.stringify(parsedServices), // Store as JSONB
        parsedTotalPrice,
        description || null,
        JSON.stringify(parsedAffiliatedLinks), // Store as JSONB
        couponCode || null,
        postDateTime || null,
        fileUrl || null,
        username,
        new Date(),
        scheduledDate,
        scheduledTime,
        type,
        parsedTotalPrice,
        influencer_name,
        "Pending",
      ];

      console.log(`[${startTime}] Executing query with values:`, values);
      const result = await pool.query(insertQuery, values);
      console.log(`[${startTime}] Query executed, result:`, result.rows[0]);

      // Commit transaction
      await pool.query("COMMIT");
      console.log(`[${startTime}] Transaction committed`);

      res.status(201).json({
        message: "Order placed successfully",
        order: result.rows[0],
      });
    } catch (err) {
      // Rollback transaction on error
      await pool.query("ROLLBACK").catch((rollbackErr) => {
        console.error(`[${startTime}] Rollback failed:`, rollbackErr.message);
      });

      console.error(`[${startTime}] Order processing error:`, {
        message: err.message,
        stack: err.stack,
        orderData: orderData,
        fileUrl: fileUrl,
        timestamp: new Date().toISOString(),
      });

      res
        .status(500)
        .json({ message: "❌ Failed to place order", error: err.message });
    }
  });

  req.pipe(busboy);
});

// GET /orders

// Get user orders, sorted by most recent first
router.get("/orders", authenticateToken, async (req, res) => {
  const startTime = new Date().toISOString(); // Timestamp for debugging
  const userId = req.user.id;

  try {
    console.log(`[${startTime}] Fetching orders for user ID: ${userId}`);

    // Check database connection
    await pool.query("SELECT 1");
    console.log(`[${startTime}] Database connection successful`);

    // Fetch orders where user is either the buyer or influencer
    const query = `
      SELECT 
        id,
        user_id,
        influencer_id,
        services,
        total_price AS amount,
        description,
        affiliated_links AS affiliatedLinks,
        coupon_code AS couponCode,
        post_datetime,
        file_url AS file,
        created_at AS orderDate,
        username,
        scheduled_date AS scheduledDate,
        scheduled_time AS scheduledTime,
        order_type AS orderType,
        inf_name AS infName,
        status
      FROM orders
      WHERE user_id = $1 OR influencer_id = $1
      ORDER BY created_at DESC;
    `;

    const result = await pool.query(query, [userId]);
    console.log(`[${startTime}] Fetched ${result.rows.length} orders`);

    res.status(200).json({
      message: "Orders fetched successfully",
      orders: result.rows,
    });
  } catch (err) {
    console.error(`[${startTime}] Error fetching orders:`, {
      message: err.message,
      stack: err.stack,
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    res
      .status(500)
      .json({ message: "Failed to fetch orders", error: err.message });
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
