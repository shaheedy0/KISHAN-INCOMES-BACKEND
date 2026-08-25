const db = require('../config/db');
const fs = require('fs');
const path = require('path');

exports.createProgram = async (req, res) => {
  const { title, description, share_price, roi_percentage, duration_days, image_url, program_type } = req.body;

  if (!title || share_price === undefined || !roi_percentage || !duration_days) {
    return res.status(400).json({ message: 'Title, price per share, ROI, and duration are required.' });
  }

  const imageUrl = req.file ? `/uploads/programs/${req.file.filename}` : (image_url || null);
  const type = (program_type === 'flexi') ? 'flexi' : 'locked'; // default locked

  try {
    const [result] = await db.execute(
      `INSERT INTO investment_programs 
       (title, description, image_url, share_price, roi_percentage, duration_days, program_type, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [title, description || '', imageUrl, parseFloat(share_price), parseFloat(roi_percentage), parseInt(duration_days), type]
    );

    res.status(201).json({
      message: 'Investment program created successfully.',
      program_id: result.insertId,
      image_url: imageUrl
    });

  } catch (error) {
    console.error('Error creating program:', error);
    res.status(500).json({ message: 'Failed to create investment program.', error: error.message });
  }
};

exports.updateProgram = async (req, res) => {
  const { id } = req.params;
  const { title, description, share_price, roi_percentage, duration_days, status, image_url, program_type } = req.body;

  try {
    const [existing] = await db.execute('SELECT * FROM investment_programs WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Investment program not found.' });
    }

    const currentProgram = existing[0];
    let imageUrlToSave = currentProgram.image_url;

    if (req.file) {
      imageUrlToSave = `/uploads/programs/${req.file.filename}`;
      if (currentProgram.image_url && currentProgram.image_url.startsWith('/uploads/')) {
        const oldFilePath = path.join(__dirname, '..', currentProgram.image_url);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
    } else if (image_url !== undefined) {
      imageUrlToSave = image_url;
    }

    const type = (program_type === 'flexi') ? 'flexi' : 'locked';

    await db.execute(
      `UPDATE investment_programs 
       SET title = ?, description = ?, image_url = ?, share_price = ?, 
           roi_percentage = ?, duration_days = ?, program_type = ?, status = ? 
       WHERE id = ?`,
      [
        title || currentProgram.title,
        description !== undefined ? description : currentProgram.description,
        imageUrlToSave,
        share_price !== undefined ? share_price : currentProgram.share_price,
        roi_percentage || currentProgram.roi_percentage,
        duration_days || currentProgram.duration_days,
        type,
        status || currentProgram.status,
        id
      ]
    );

    res.json({ message: 'Investment program updated successfully.', image_url: imageUrlToSave });

  } catch (error) {
    console.error('Error updating program:', error);
    res.status(500).json({ message: 'Failed to update investment program.', error: error.message });
  }
};

exports.getAllPrograms = async (req, res) => {
  try {
    const [programs] = await db.execute(
      `SELECT id, title, description, share_price, 
              roi_percentage, duration_days, program_type, image_url 
       FROM investment_programs 
       WHERE status = 'active'
       ORDER BY id DESC`
    );
    res.json(programs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching investment programs.' });
  }
};

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