// dragSort.js
// Click-and-drag reordering of category sections via SortableJS, persisting the order.

export function enableDragSort(containerId, onReorder) {
    const container = document.getElementById(containerId);
    if (!container || !window.Sortable) return;
    if (container._sortable) container._sortable.destroy();

    container._sortable = window.Sortable.create(container, {
        handle: '.drag-handle', 
        draggable: '.category-section',
        animation: 150,
        onEnd: () => {
            const order = Array.from(container.querySelectorAll('.category-section'))
                .map(s => s.querySelector('.category-header').childNodes[0].textContent.trim())
                .filter(Boolean);
            onReorder(order);
        }
    });
}