export const parseUTCString = (dateStr: string | number | Date | null | undefined): Date => {
    if (!dateStr) return new Date();

    // If it's already a Date or a number (timestamp), just return/parse it directly
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr === 'number') return new Date(dateStr);

    let finalStr = dateStr;
    // Ensure we treat the string as UTC if it lacks timezone info
    if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.match(/[+-]\d{2}:?\d{2}$/)) {
        finalStr = `${dateStr}Z`;
    }

    return new Date(finalStr);
};

export const formatToPhTime = (dateStr: string | number | Date | null | undefined) => {
    if (!dateStr) return { date: 'N/A', time: '' }

    const date = parseUTCString(dateStr);

    return {
        date: date.toLocaleDateString('en-US', {
            timeZone: 'Asia/Manila',
            month: 'numeric',
            day: 'numeric',
            year: 'numeric'
        }),
        time: date.toLocaleTimeString('en-US', {
            timeZone: 'Asia/Manila',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        }),
        full: date.toLocaleString('en-US', {
            timeZone: 'Asia/Manila',
            dateStyle: 'short',
            timeStyle: 'short'
        })
    }
}
