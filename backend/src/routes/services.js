const express = require('express');
const router = express.Router();
const clinicService = require('../services/clinicService');
const asyncHandler = require('../utils/asyncHandler');

router.get('/', asyncHandler(async (req, res) => {
  res.json(clinicService.listServices());
}));

module.exports = router;
