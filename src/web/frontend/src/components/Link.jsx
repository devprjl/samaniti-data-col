import { navigate } from "../lib/router";

export default function Link({ to, onClick, target, children, ...props }) {
    function handleClick(event) {
        onClick?.(event);

        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            target === "_blank"
        ) {
            return;
        }

        event.preventDefault();
        navigate(to);
    }

    return (
        <a href={to} target={target} onClick={handleClick} {...props}>
            {children}
        </a>
    );
}
