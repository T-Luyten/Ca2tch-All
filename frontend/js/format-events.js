// Condition visibility and legend editors have their own event handlers.
// Redrawing them on a bubbling input event can remove a checkbox before change fires.
export function bindFormatControlEvents(panel, onControlsChanged) {
    const handleEvent = event => {
        if (event.target?.dataset?.control) onControlsChanged();
    };
    panel.addEventListener('input', handleEvent);
    panel.addEventListener('change', handleEvent);
}
