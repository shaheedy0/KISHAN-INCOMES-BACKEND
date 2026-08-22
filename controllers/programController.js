const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// Create New Investment Program (Admin Only)
exports.createProgram = async (req, res) => {
  const { title, description, amount_per_share, roi_percentage, duration_days } = req.body;

  if (!title || !amount_per_share || !roi_percentage || !duration_days) {
    return res.status(400).json({ message: 'Title, amount per share, ROI, and duration are required.' });
  }

  const imageUrl = req.file ? `/uploads/programs/${req.file.filename}` : null;

  try {
    const [result] = await db.execute(
      `INSERT INTO investment_programs 
       (title, description, image_url, amount_per_share, roi_percentage, duration_days, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [title, description || '', imageUrl, amount_per_share, roi_percentage, duration_days]
    );

    res.status(201).json({
      message: 'Investment program created successfully.',
      program_id: result.insertId,
      image_url: imageUrl
    });

  } catch (error) {
    console.error('Error creating program:', error);
    res.status(500).json({ message: 'Failed to create investment program.' });
  }
};

// Update Existing Program (Admin Only)
exports.updateProgram = async (req, res) => {
  const { id } = req.params;
  const { title, description, amount_per_share, roi_percentage, duration_days, is_active } = req.body;

  try {
    // Fetch current record
    const [existing] = await db.execute('SELECT * FROM investment_programs WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Investment program not found.' });
    }

    const currentProgram = existing[0];
    let imageUrl = currentProgram.image_url;

    // If a new file was uploaded, update image path and remove the old file
    if (req.file) {
      imageUrl = `/uploads/programs/${req.file.filename}`;

      if (currentProgram.image_url) {
        const oldFilePath = path.join(__dirname, '..', currentProgram.image_url);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
    }

    await db.execute(
      `UPDATE investment_programs 
       SET title = ?, description = ?, image_url = ?, amount_per_share = ?, 
           roi_percentage = ?, duration_days = ?, is_active = ? 
       WHERE id = ?`,
      [
        title || currentProgram.title,
        description !== undefined ? description : currentProgram.description,
        imageUrl,
        amount_per_share || currentProgram.amount_per_share,
        roi_percentage || currentProgram.roi_percentage,
        duration_days || currentProgram.duration_days,
        is_active !== undefined ? is_active : currentProgram.is_active,
        id
      ]
    );

    res.json({ message: 'Investment program updated successfully.', image_url: imageUrl });

  } catch (error) {
    console.error('Error updating program:', error);
    res.status(500).json({ message: 'Failed to update investment program.' });
  }
};

// Get All Active Investment Programs (Public/User Endpoint)
exports.getAllPrograms = async (req, res) => {
  try {
    const [programs] = await db.execute(
      'SELECT * FROM investment_programs WHERE is_active = TRUE ORDER BY created_at DESC'
    );
    res.json(programs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching investment programs.' });
  }
};

// Get Single Program by ID
exports.getProgramById = async (req, res) => {
  try {
    const [programs] = await db.execute(
      'SELECT * FROM investment_programs WHERE id = ?',
      [req.params.id]
    );
    if (programs.length === 0) {
      return res.status(404).json({ message: 'Program not found.' });
    }
    res.json(programs[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching program details.' });
  }
};