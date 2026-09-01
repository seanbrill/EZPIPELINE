import { Router, Request, Response } from 'express';
import { ConfigController } from '../controllers/ConfigController.js';
import Logger from '../controllers/Logger.js';
import { PermissionsService } from '../services/PermissionsService.js';

const router = Router();
const configController = ConfigController.getInstance();
const logger = Logger.getInstance();
const permissions = PermissionsService.getInstance();

// Helper to check permission
const checkGlobalPerm = (req: Request, res: Response, output: 'view' | 'editEnv') => {
    const user = (req as any).user;
    if (!permissions.checkPermission(user.id, 'global-env', output)) {
        res.status(403).json({ error: "Access denied to Global Environment" });
        return false;
    }
    return true;
};

// GET /api/global-env/keys - List all global env variable keys (values redacted)
router.get('/keys', (req: Request, res: Response) => {
    try {
        if (!checkGlobalPerm(req, res, 'view')) return;
        const keys = configController.getGlobalEnvKeys();
        res.json({ keys });
    } catch (error: any) {
        logger.error('Failed to get global env keys', error);
        res.status(500).json({ error: error.message || 'Failed to get global env variables' });
    }
});

// GET /api/global-env/keys-with-values - List all global env variables with values (for UI only)
router.get('/keys-with-values', (req: Request, res: Response) => {
    try {
        if (!checkGlobalPerm(req, res, 'editEnv')) return; // Require Edit to see values
        const vars = configController.getGlobalEnvKeysWithValues();
        res.json({ variables: vars });
    } catch (error: any) {
        logger.error('Failed to get global env keys with values', error);
        res.status(500).json({ error: error.message || 'Failed to get global env variables' });
    }
});

// POST /api/global-env/set - Set/update a global env variable
router.post('/set', (req: Request, res: Response) => {
    try {
        if (!checkGlobalPerm(req, res, 'editEnv')) return;
        const { key, value } = req.body;

        if (!key || typeof key !== 'string') {
            res.status(400).json({ error: 'Invalid key' });
            return;
        }

        if (value === undefined) {
            res.status(400).json({ error: 'Value is required' });
            return;
        }

        configController.setGlobalEnvVariable(key, String(value));
        res.json({ success: true, message: `Global env variable '${key}' set successfully` });
    } catch (error: any) {
        logger.error('Failed to set global env variable', error);
        res.status(500).json({ error: error.message || 'Failed to set global env variable' });
    }
});

// DELETE /api/global-env/:key - Delete a global env variable
router.delete('/:key', (req: Request, res: Response) => {
    try {
        if (!checkGlobalPerm(req, res, 'editEnv')) return;
        const { key } = req.params;

        if (!key) {
            res.status(400).json({ error: 'Key is required' });
            return;
        }

        configController.deleteGlobalEnvVariable(key);
        res.json({ success: true, message: `Global env variable '${key}' deleted successfully` });
    } catch (error: any) {
        logger.error('Failed to delete global env variable', error);
        res.status(500).json({ error: error.message || 'Failed to delete global env variable' });
    }
});

export default router;
