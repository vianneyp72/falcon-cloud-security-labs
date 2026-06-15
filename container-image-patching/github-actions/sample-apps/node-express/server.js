const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.json({ message: "Falcon Sensor Patching Lab", service: "node-express" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Server running on port 3000");
});
