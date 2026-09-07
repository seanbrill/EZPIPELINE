import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmationContext';
// import { Clock, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import API_URL from '../../config/api';

interface ScheduleTabProps {
    pipelineTarget: string;
}

const ScheduleTab: React.FC<ScheduleTabProps> = ({ pipelineTarget }) => {
    const { token } = useAuth();
    const { confirm } = useConfirm();
    const [schedules, setSchedules] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Builder State
    const [mode, setMode] = useState<'builder' | 'raw'>('builder');
    const [frequency, setFrequency] = useState('daily');
    const [hour, setHour] = useState('02');
    const [minute, setMinute] = useState('00');
    const [dayOfWeek, setDayOfWeek] = useState('1'); // Monday
    const [rawCron, setRawCron] = useState('');

    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');

    const loadSchedules = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/schedules/${pipelineTarget}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            setSchedules(data.schedules || []);
        } catch (e) {
            console.error('Failed to load schedules', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSchedules();
    }, [pipelineTarget]);

    const getCronFromBuilder = () => {
        // Simple builder logic
        switch (frequency) {
            case 'daily':
                return `${parseInt(minute)} ${parseInt(hour)} * * * `;
            case 'weekly':
                return `${parseInt(minute)} ${parseInt(hour)} * * ${dayOfWeek} `;
            case 'hourly':
                return `${parseInt(minute)} * * * * `;
            default:
                return '0 0 * * *';
        }
    };

    const createSchedule = async () => {
        const cronExpression = mode === 'builder' ? getCronFromBuilder() : rawCron;

        if (!cronExpression.trim()) {
            setError('Cron expression is required');
            return;
        }

        try {
            setCreating(true);
            setError('');
            const res = await fetch(`${API_URL}/api/schedules`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    pipelineTarget,
                    cronExpression
                })
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error || 'Failed to create schedule');
                return;
            }

            setRawCron('');
            loadSchedules();
        } catch (e) {
            setError('Failed to create schedule');
        } finally {
            setCreating(false);
        }
    };

    const deleteSchedule = async (id: number) => {
        if (!await confirm({
            title: "Delete Schedule?",
            message: "Are you sure you want to delete this schedule?",
            confirmText: "Delete",
            isDangerous: true
        })) return;

        try {
            await fetch(`${API_URL}/api/schedules/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            loadSchedules();
        } catch (e) {
            console.error('Failed to delete schedule', e);
        }
    };

    const toggleSchedule = async (id: number, enabled: boolean) => {
        try {
            await fetch(`${API_URL}/api/schedules/${id}/toggle`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ enabled })
            });
            loadSchedules();
        } catch (e) {
            console.error('Failed to toggle schedule', e);
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-full text-slate-400">Loading schedules...</div>;
    }

    return (
        <div className="h-full flex flex-col gap-4 p-6 bg-[#1e1e1e]">
            <div>
                <h3 className="text-lg font-semibold text-white mb-3">Scheduled Runs</h3>
                <p className="text-sm text-slate-400 mb-4">
                    Automatically run this pipeline on a schedule.
                </p>

                {/* Create Schedule Form */}
                <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 mb-4">
                    <div className="flex gap-4 mb-4 border-b border-slate-800 pb-2">
                        <button
                            onClick={() => setMode('builder')}
                            className={`text-xs font-bold uppercase tracking-wider pb-1 ${mode === 'builder' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Simple Builder
                        </button>
                        <button
                            onClick={() => setMode('raw')}
                            className={`text-xs font-bold uppercase tracking-wider pb-1 ${mode === 'raw' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Advanced (CRON)
                        </button>
                    </div>

                    {mode === 'builder' ? (
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <div className="space-y-1 flex-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Frequency</label>
                                    <select
                                        value={frequency}
                                        onChange={(e) => setFrequency(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
                                    >
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="hourly">Hourly</option>
                                    </select>
                                </div>
                                {frequency !== 'hourly' && (
                                    <div className="space-y-1 w-24">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Time</label>
                                        <div className="flex gap-1 items-center">
                                            <input
                                                value={hour}
                                                onChange={(e) => setHour(e.target.value)}
                                                className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-2 text-sm text-center text-white focus:border-emerald-500 outline-none"
                                                maxLength={2}
                                            />
                                            <span className="text-slate-500">:</span>
                                            <input
                                                value={minute}
                                                onChange={(e) => setMinute(e.target.value)}
                                                className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-2 text-sm text-center text-white focus:border-emerald-500 outline-none"
                                                maxLength={2}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {frequency === 'weekly' && (
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Day of Week</label>
                                    <div className="flex gap-2">
                                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                                            <button
                                                key={day}
                                                onClick={() => setDayOfWeek(idx.toString())}
                                                className={`px-3 py-1 rounded text-xs font-bold transition-all ${dayOfWeek === idx.toString() ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                            >
                                                {day}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="bg-black/30 p-2 rounded border border-slate-800">
                                <code className="text-xs text-emerald-400 font-mono">Run at: {getCronFromBuilder()}</code>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Cron Expression
                            </label>
                            <input
                                type="text"
                                value={rawCron}
                                onChange={(e) => setRawCron(e.target.value)}
                                placeholder="0 2 * * * (daily at 2 AM)"
                                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white font-mono focus:border-emerald-500 outline-none"
                            />
                            <div className="mt-2 text-xs text-slate-500">
                                Standard CRON syntax: Minute Hour Day Month DayOfWeek
                            </div>
                        </div>
                    )}

                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={createSchedule}
                            disabled={creating}
                            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition-colors disabled:opacity-50"
                        >
                            {creating ? 'Creating...' : 'Create Schedule'}
                        </button>
                    </div>

                    {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
                </div>
            </div>

            {/* Existing Schedules */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Active Schedules</h4>
                {schedules.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 border border-dashed border-slate-800 rounded-lg">
                        No schedules configured for this pipeline.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {schedules.map((schedule) => (
                            <div
                                key={schedule.id}
                                className="bg-slate-900/30 border border-slate-700 rounded-lg p-3 flex items-center justify-between"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-3">
                                        <code className="text-sm font-mono text-emerald-400 bg-slate-950 px-2 py-1 rounded">
                                            {schedule.cron_expression}
                                        </code>
                                        <span className={`text-xs px-2 py-0.5 rounded ${schedule.enabled ? 'bg-emerald-900/30 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                                            {schedule.enabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1 flex gap-4">
                                        {schedule.last_run && (
                                            <span>Last: {format(new Date(schedule.last_run), 'MMM d, HH:mm')}</span>
                                        )}
                                        {schedule.next_run && (
                                            <span>Next: {format(new Date(schedule.next_run), 'MMM d, HH:mm')}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleSchedule(schedule.id, !schedule.enabled)}
                                        className={`px-3 py-1 text-xs rounded transition-colors ${schedule.enabled
                                            ? 'bg-slate-700 hover:bg-slate-600 text-white'
                                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                            }`}
                                    >
                                        {schedule.enabled ? 'Disable' : 'Enable'}
                                    </button>
                                    <button
                                        onClick={() => deleteSchedule(schedule.id)}
                                        className="px-3 py-1 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScheduleTab;
