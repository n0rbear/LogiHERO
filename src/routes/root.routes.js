const express = require('express');

const createRootRoutes = () => {
    const rootRoutes = express.Router();

    // Redirect root to Admin Dashboard
    rootRoutes.get('/', (req, res) => {
        res.redirect('/admin');
    });

    return rootRoutes;
};

module.exports = createRootRoutes;
