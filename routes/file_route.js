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
  const startTime = new Date().toISOString();

  let orderData = {};
  const uploadPromises = []; // collect all uploads
  const uploadedUrls = []; // resulting secure_url list (keep single too)

  busboy.on("field", (fieldname, val) => {
    try {
      if (["services", "affiliatedLinks"].includes(fieldname)) {
        orderData[fieldname] = JSON.parse(val);
      } else {
        orderData[fieldname] = val;
      }
      console.log(`[${startTime}] Field [${fieldname}]:`, val);
    } catch (err) {
      console.error(
        `[${startTime}] Error parsing field [${fieldname}]: ${err.message}`
      );
      orderData[fieldname] = val;
    }
  });

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    const baseName = (
      filename ? filename.toString() : `uploaded_file_${Date.now()}`
    ).replace(/\.[^/.]+$/g, "");
    // Map mimetype -> Cloudinary resource_type
    const resource_type = mimetype?.startsWith("image/")
      ? "image"
      : mimetype?.startsWith("video/") || mimetype === "audio/mpeg"
      ? "video"
      : "raw";

    const uploadP = new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "orders",
          public_id: baseName,
          overwrite: true,
          resource_type, // correct type
        },
        (err, result) => {
          if (err) {
            console.error(`[${startTime}] Cloudinary upload error:`, err);
            return reject(err);
          }
          console.log(
            `[${startTime}] File uploaded successfully: ${result?.secure_url}`
          );
          uploadedUrls.push(result.secure_url);
          resolve(result.secure_url);
        }
      );
      file.on("limit", () => {
        stream.destroy(new Error("File size limit reached"));
      });
      file.pipe(stream);
    });

    uploadPromises.push(uploadP);
  });

  busboy.on("finish", async () => {
    try {
      // Wait for all uploads to finish BEFORE using fileUrl
      if (uploadPromises.length) {
        await Promise.all(uploadPromises);
      }
      const fileUrl = uploadedUrls || null; // single file use-case; extend if you store multiple

      console.log(`[${startTime}] Processing order data:`, orderData);
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
            "Missing required fields: userId, influencerId, services, type, or influencer_name",
        });
      }

      // totalPrice fallback
      let parsedTotalPrice = parseFloat(totalPrice);
      if (isNaN(parsedTotalPrice) || parsedTotalPrice < 0) {
        let calculatedTotalPrice = 0;
        try {
          const parsedServicesTmp = Array.isArray(services)
            ? services
            : JSON.parse(services);
          calculatedTotalPrice = parsedServicesTmp.reduce(
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

      if (userId != req.user.id) {
        console.log(`[${startTime}] Unauthorized user ID mismatch:`, {
          userId,
          reqUserId: req.user.id,
        });
        return res
          .status(403)
          .json({ message: "Unauthorized user ID mismatch" });
      }

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

      const userQuery = `SELECT username FROM users WHERE id = $1`;
      const userResult = await pool.query(userQuery, [influencerId]);
      if (!userResult.rows) {
        console.log(
          `[${startTime}] Influencer not found for ID:`,
          influencerId
        );
        return res.status(404).json({ message: "Influencer not found" });
      }
      const username = userResult.rows.username || frontendUsername;

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

      // Schedule split
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
        scheduledDate = postDate.toISOString().split("T");
        scheduledTime = postDate.toTimeString().split(" ");
      }

      await pool.query("BEGIN");
      console.log(`[${startTime}] Transaction started`);

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
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *;
      `;

      const values = [
        userId,
        influencerId,
        JSON.stringify(parsedServices),
        parsedTotalPrice,
        description || null,
        JSON.stringify(parsedAffiliatedLinks),
        couponCode || null,
        postDateTime || null,
        fileUrl || null, // now resolved
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
      await pool.query("COMMIT");
      console.log(`[${startTime}] Transaction committed`);

      res
        .status(201)
        .json({ message: "Order placed successfully", order: result.rows });
    } catch (err) {
      await pool.query("ROLLBACK").catch((rollbackErr) => {
        console.error(`[${startTime}] Rollback failed:`, rollbackErr.message);
      });
      console.error(`[${startTime}] Order processing error:`, {
        message: err.message,
        stack: err.stack,
        orderData,
        uploadedUrls,
        timestamp: new Date().toISOString(),
      });
      res
        .status(500)
        .json({ message: "❌ Failed to place order", error: err.message });
    }
  });

  req.pipe(busboy);
});

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
